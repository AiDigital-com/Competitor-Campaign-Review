/**
 * Lambda 2: VERIFY (GATE)
 * LLM classifies each competitor as Brand + Product, filters irrelevant.
 * Selects top 3 campaigns per brand from adv_campaign_channel_summary.
 * Output: verified domains + selected campaigns → inserts 3 parallel tasks.
 */
import type { Config } from '@netlify/functions';
import { createLLMProvider } from '@AiDigital-com/design-system/server';
import { createClient as createSupabase } from '@supabase/supabase-js';
import { getSupabase, mergeReportData, setStep, insertTasks, markError, APP_NAME } from './_shared/pipeline.js';
import { log } from './_shared/logger.js';

export default async (req: Request) => {
  const { jobId, brandDomain, userId, candidateDomains, summaries } = await req.json();
  const supabase = getSupabase();

  try {
    await setStep(supabase, jobId, 'Verifying competitors…');

    // LLM verification with summary context
    const llm = createLLMProvider('gemini', process.env.GEMINI_API_KEY!, 'fast', { supabase });

    const summaryContext = candidateDomains.map((d: string) => {
      const s = summaries[d];
      return s
        ? `- ${d}: ${fmtM(s.totalImpressions)} imps, $${fmtM(s.totalSpend)} spend, channels: ${(s.channels || []).map((c: any) => c.name).join(', ')}`
        : `- ${d}: no ad data`;
    }).join('\n');

    let verified: { domain: string; parentCompany: string; productLine: string; keep: boolean }[] = [];
    try {
      const result = await llm.generateContent({
        system: `You classify advertising domains for competitive analysis. Return ONLY valid JSON array — no markdown.
Each element: {"domain":"...","parentCompany":"...","productLine":"...","keep":true/false}
- parentCompany: owning corporation (e.g. "PepsiCo")
- productLine: specific product focus (e.g. "Core Pepsi beverages" vs "Muscle Milk / corporate")
- keep: false ONLY if clearly not a competitor (social platforms, search engines, unrelated industry)
- Do NOT remove domains just because they share a parent company`,
        userParts: [{ text: `Brand: ${brandDomain}\nCandidate competitors with spend data:\n${summaryContext}` }],
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

    const keptDomains = verified.filter(c => c.keep).map(c => c.domain.toLowerCase());
    const annotations: Record<string, { parentCompany: string; productLine: string }> = {};
    for (const v of verified) {
      annotations[v.domain.toLowerCase()] = { parentCompany: v.parentCompany, productLine: v.productLine };
    }

    console.log(`[verify] ${verified.length} candidates → ${keptDomains.length} kept`);

    // Fetch campaign metadata for verified domains + brand (from training data)
    const sb = createSupabase(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const allDomains = [brandDomain.toLowerCase(), ...keptDomains];
    const { data: campRows } = await sb
      .from('ccr_training_data')
      .select('advertiser_domain, data')
      .eq('data_type', 'adv_campaign_channel_summary')
      .in('advertiser_domain', allDomains);

    // Fetch landing page URLs from campaign_channel_detail (actual LP URLs from raw BQ)
    const { data: detailRows } = await sb
      .from('ccr_training_data')
      .select('advertiser_domain, data')
      .eq('data_type', 'campaign_channel_detail')
      .in('advertiser_domain', allDomains);

    // Build campaign name → landing page URL map per domain
    const lpByDomain: Record<string, Record<string, string>> = {};
    for (const row of detailRows || []) {
      const details = Array.isArray(row.data) ? row.data : [];
      const byName: Record<string, string> = {};
      for (const d of details) {
        if (d.creative_campaign_name && d.landing_page_url && !byName[d.creative_campaign_name]) {
          byName[d.creative_campaign_name] = d.landing_page_url.split('?')[0]; // strip UTMs
        }
      }
      lpByDomain[row.advertiser_domain] = byName;
    }

    // Select top 3 campaigns per domain (by rank), attach landing page URL
    // Campaign names differ by trailing ID suffix — match by prefix
    const topCampaigns: Record<string, any[]> = {};
    for (const row of campRows || []) {
      const campaigns = Array.isArray(row.data) ? row.data : [];
      const sorted = campaigns.sort((a: any, b: any) => (a.campaign_rank || 999) - (b.campaign_rank || 999));
      const domainLPs = lpByDomain[row.advertiser_domain] || {};
      const lpKeys = Object.keys(domainLPs);
      topCampaigns[row.advertiser_domain] = sorted.slice(0, 3).map((c: any) => {
        let lp = domainLPs[c.creative_campaign_name];
        if (!lp) {
          const campBase = (c.creative_campaign_name || '').replace(/\s+\d{7,}$/, '');
          const match = lpKeys.find(k => k.startsWith(campBase) || campBase.startsWith(k));
          if (match) lp = domainLPs[match];
        }
        return { ...c, landing_page_url: lp || null };
      });
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

    // GATE: insert 3 parallel tasks
    const sharedPayload = { jobId, brandDomain, userId, verifiedDomains: keptDomains, annotations };

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
