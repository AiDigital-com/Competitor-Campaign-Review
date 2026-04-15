/**
 * Lambda 2: VERIFY (GATE)
 * LLM classifies each competitor as Brand + Product, filters irrelevant.
 * Selects top 3 campaigns per brand from adv_campaign_channel_summary.
 * Output: verified domains + selected campaigns → inserts 3 parallel tasks.
 */
import type { Config } from '@netlify/functions';
import { createLLMProvider } from '@AiDigital-com/design-system/server';
import { getSupabase, mergeReportData, setStep, insertTasks, markError, APP_NAME } from './_shared/pipeline.js';
import { getCampaignDetail } from './_shared/bigquery.js';
import { log } from './_shared/logger.js';

export default async (req: Request) => {
  const { jobId, brandDomain, userId, candidateDomains, candidateCampaigns, summaries } = await req.json();
  const supabase = getSupabase();

  try {
    await setStep(supabase, jobId, 'Verifying competitors…');

    // LLM verification with summary + campaign name context
    const llm = createLLMProvider('gemini', process.env.GEMINI_API_KEY!, 'fast', { supabase });

    // Include brand in context so LLM classifies its product line too
    const brandCampaigns = (candidateCampaigns?.[brandDomain.toLowerCase()] || []).slice(0, 3);
    const brandCampStr = brandCampaigns.length > 0 ? ` | Top campaigns: ${brandCampaigns.map((c: string) => `"${c}"`).join(', ')}` : '';

    const summaryContext = candidateDomains.map((d: string) => {
      const s = summaries[d];
      const campaigns = (candidateCampaigns?.[d] || []).slice(0, 3);
      const campStr = campaigns.length > 0 ? `\n    Top campaigns: ${campaigns.map((c: string) => `"${c}"`).join(', ')}` : '';
      return s
        ? `- ${d}: ${fmtM(s.totalImpressions)} imps, $${fmtM(s.totalSpend)} spend, channels: ${(s.channels || []).map((c: any) => c.name).join(', ')}${campStr}`
        : `- ${d}: no ad data`;
    }).join('\n');

    let verified: { domain: string; parentCompany: string; productLine: string; keep: boolean }[] = [];
    try {
      const result = await llm.generateContent({
        system: `You classify advertising domains for competitive analysis based on their PRODUCT LINE, not just industry.
Return ONLY valid JSON array — no markdown.
Each element: {"domain":"...","parentCompany":"...","productLine":"...","keep":true/false}
- parentCompany: owning corporation
- productLine: specific product focus derived from campaign names (e.g. "retirement planning" vs "car insurance")
- keep: true ONLY if the competitor sells the SAME TYPE of product as the brand
  - Example: if brand runs "retirement planning" campaigns, keep competitors with retirement/401k/annuity campaigns
  - Remove competitors in the same industry but different product line (e.g. car insurance vs retirement)
- Do NOT remove domains just because they share a parent company — they may have distinct product lines`,
        userParts: [{ text: `Brand: ${brandDomain}${brandCampStr}\n\nCandidate competitors with spend data and campaign names:\n${summaryContext}\n\nIMPORTANT: Include the brand (${brandDomain}) as the FIRST element in your response with keep=true. Classify its productLine from its campaign names.` }],
        app: `${APP_NAME}:verify`,
        userId,
        jsonMode: true,
      });
      try {
        verified = JSON.parse(result.text);
      } catch {
        const match = result.text.match(/\[[\s\S]*\]/);
        if (match) verified = JSON.parse(match[0]);
      }
    } catch (err) {
      console.warn('[verify] LLM failed, using unverified list:', err);
      verified = candidateDomains.map((d: string) => ({ domain: d, parentCompany: '', productLine: '', keep: true }));
    }

    // Exclude brand from competitor list — brand is classified for its productLine but isn't a competitor
    const brandKey = brandDomain.toLowerCase();
    const keptDomains = verified.filter(c => c.keep && c.domain.toLowerCase() !== brandKey).map(c => c.domain.toLowerCase());
    const annotations: Record<string, { parentCompany: string; productLine: string }> = {};
    for (const v of verified) {
      annotations[v.domain.toLowerCase()] = { parentCompany: v.parentCompany, productLine: v.productLine };
    }

    console.log(`[verify] ${verified.length} candidates → ${keptDomains.length} kept`);

    // Fetch campaign detail for verified domains + brand
    // Uses relational ccr_campaign_channel_detail table — LP URLs included naturally
    const allDomains = [brandDomain.toLowerCase(), ...keptDomains];
    const campaignRows = await getCampaignDetail(allDomains, 100);

    // Group by domain, deduplicate by campaign name (take highest-impression row per campaign)
    const topCampaigns: Record<string, any[]> = {};
    for (const row of campaignRows) {
      const d = row.advertiser_domain;
      if (!topCampaigns[d]) topCampaigns[d] = [];
      // Only keep first occurrence per campaign name (already sorted by impressions desc)
      const campName = row.creative_campaign_name;
      if (!topCampaigns[d].some((c: any) => c.creative_campaign_name === campName)) {
        topCampaigns[d].push(row);
      }
    }
    // Limit to top 3 per domain
    for (const d of Object.keys(topCampaigns)) {
      topCampaigns[d] = topCampaigns[d].slice(0, 3);
    }

    // Write verified state to report_data — comparison table can render now
    await mergeReportData(supabase, jobId, {
      phase: 'verified',
      verifiedDomains: keptDomains,
      annotations,
      topCampaigns,
    });

    log.info('ccr-verify.complete', {
      function_name: 'ccr-verify',
      user_id: userId,
      entity_id: jobId,
      meta: { verified: keptDomains.length, filtered: candidateDomains.length - keptDomains.length },
    });

    // Brand's product line for campaign-level filtering in Lambda 3a
    const brandAnnotation = annotations[brandDomain.toLowerCase()];
    const brandProductLine = brandAnnotation?.productLine || '';

    // GATE: insert 3 parallel tasks
    const sharedPayload = { jobId, brandDomain, brandProductLine, userId, verifiedDomains: keptDomains, annotations };

    await insertTasks(supabase, jobId, [
      { taskType: 'ccr_campaign_detail', payload: { ...sharedPayload, topCampaigns } },
      { taskType: 'ccr_firecrawl', payload: { ...sharedPayload, topCampaigns } },
      { taskType: 'ccr_publishers', payload: sharedPayload },
    ]);

  } catch (err) {
    console.error('[verify] Error:', err);
    await markError(supabase, jobId, jobId, err as Error);
  }
};

function fmtM(n: number): string {
  if (!n) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export const config: Config = { background: true };
