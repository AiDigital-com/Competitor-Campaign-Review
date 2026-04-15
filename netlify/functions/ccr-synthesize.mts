/**
 * Lambda 4: SYNTHESIZE
 * LLM generates structured insights from full report context.
 * Reads complete report_data, produces exec summary + 3 action categories.
 * Marks pipeline complete.
 */
import type { Config } from '@netlify/functions';
import { createLLMProvider } from '@AiDigital-com/design-system/server';
import {
  getSupabase, mergeReportData, setStep, markComplete, markError,
  APP_NAME, SESSION_TABLE,
} from './_shared/pipeline.js';
import { log } from './_shared/logger.js';
import type { CcrInsights, CampaignData } from '../../src/lib/types.js';

export default async (req: Request) => {
  const { jobId, brandDomain, userId } = await req.json();
  const supabase = getSupabase();

  try {
    await setStep(supabase, jobId, 'Generating strategic analysis…');

    // Read full report_data accumulated by Lambdas 1-3
    const { data: session } = await supabase
      .from(SESSION_TABLE)
      .select('report_data')
      .eq('id', jobId)
      .single();

    const rd = (session?.report_data || {}) as Record<string, any>;
    const brand = rd.brand as CampaignData | undefined;
    const competitors = (rd.competitors || []) as CampaignData[];
    const landingPages = rd.landingPages || [];
    const publishersByDomain = rd.publishersByDomain || {};

    // Build rich analysis context
    const context = buildAnalysisContext(brandDomain, brand, competitors, landingPages, publishersByDomain);

    const llm = createLLMProvider('gemini', process.env.GEMINI_API_KEY!, 'analysis', { supabase });

    const result = await llm.generateContent({
      system: `You are a competitive intelligence analyst specializing in digital advertising and creative strategy.
Return ONLY valid JSON matching this structure — no markdown, no code fences:
{
  "executiveSummary": "One paragraph (3-5 sentences). Compare brand's creative performance to closest competitor by spend. Reference specific numbers. Highlight creative format differences and landing page strategy.",
  "creativeActions": [{"action": "short directive", "rationale": "data-backed reason"}],
  "spendingActions": [{"action": "short directive", "rationale": "data-backed reason"}],
  "channelActions": [{"action": "short directive", "rationale": "data-backed reason"}]
}
Rules:
- executiveSummary: Focus on brand vs closest competitor by spend. Compare creative formats, channel mix, CPM, and landing page approaches.
- creativeActions: 2-3 actions on creative strategy (format, messaging, landing page gaps).
- spendingActions: 2-3 actions on budget allocation (CPM efficiency, publisher concentration).
- channelActions: 2-3 actions on channel strategy (underweight/overweight vs competition).
- Every rationale MUST cite specific numbers from the data.`,
      userParts: [{ text: context }],
      app: `${APP_NAME}:synthesize`,
      userId: userId ?? undefined,
      maxTokens: 4096,
      jsonMode: true,
    });

    let insights: CcrInsights | undefined;
    try {
      insights = JSON.parse(result.text) as CcrInsights;
    } catch {
      const match = result.text.match(/\{[\s\S]*\}/);
      if (match) try { insights = JSON.parse(match[0]) as CcrInsights; } catch {}
    }

    const narrative = insights?.executiveSummary || result.text;

    // Write final insights to report_data
    await mergeReportData(supabase, jobId, {
      phase: 'complete',
      narrative,
      insights,
    });

    log.info('ccr-synthesize.complete', {
      function_name: 'ccr-synthesize',
      user_id: userId,
      entity_id: jobId,
      ai_provider: llm.provider,
      ai_model: llm.model,
      ai_input_tokens: result.usage?.inputTokens,
      ai_output_tokens: result.usage?.outputTokens,
    });

    // Mark pipeline complete
    await markComplete(supabase, jobId, jobId);

  } catch (err) {
    console.error('[synthesize] Error:', err);
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

function buildAnalysisContext(
  brandDomain: string,
  brand: CampaignData | undefined,
  competitors: CampaignData[],
  landingPages: any[],
  publishersByDomain: Record<string, any[]>,
): string {
  const fmtChannels = (d: CampaignData) =>
    (d.channels || []).map(c => `${c.name}: ${fmtM(c.impressions)} imps ($${fmtM(c.spend)})`).join(', ') || 'none';

  const fmtCreatives = (d: CampaignData) =>
    (d.creatives || []).slice(0, 5).map(c => {
      const isVideo = (c.url || '').includes('video') || (c.url || '').endsWith('.mp4');
      return `  - ${isVideo ? 'VIDEO' : 'IMAGE'}: ${fmtM(c.impressions || 0)} imps, $${fmtM(c.spend || 0)} | campaign: "${(c.campaignName || '').replace(/\s+\d{7,}$/, '')}" | since: ${c.firstSeen || '?'}`;
    }).join('\n') || '  (no creatives)';

  const fmtPubs = (domain: string) => {
    const pubs = publishersByDomain[domain] || [];
    return pubs.slice(0, 5).map((p: any) =>
      `  - ${p.publisher}: ${fmtM(p.impressions)} imps, $${fmtM(p.spend)} (${p.transactionMethod})`
    ).join('\n') || '  (no publisher data)';
  };

  const fmtLPs = (domain: string) => {
    const lps = landingPages.filter((lp: any) => lp.domain === domain);
    return lps.slice(0, 3).map((lp: any) =>
      `  - "${lp.campaignName}": ${lp.url}\n    Title: ${lp.title || 'N/A'} | ${lp.description || 'N/A'}`
    ).join('\n') || '  (no landing pages crawled)';
  };

  const cpm = (d: CampaignData) => d.totalImpressions > 0 ? `$${((d.totalSpend / d.totalImpressions) * 1000).toFixed(2)}` : 'N/A';

  const all = brand ? [brand, ...competitors] : competitors;
  const totalImps = all.reduce((s, d) => s + d.totalImpressions, 0) || 1;

  const brandBlock = brand ? `BRAND: ${brandDomain}
- Impressions: ${fmtM(brand.totalImpressions)} (SOV: ${((brand.totalImpressions / totalImps) * 100).toFixed(1)}%)
- Spend: $${fmtM(brand.totalSpend)} | CPM: ${cpm(brand)}
- Channels: ${fmtChannels(brand)}
- Top Creatives:\n${fmtCreatives(brand)}
- Top Publishers:\n${fmtPubs(brandDomain.toLowerCase())}
- Landing Pages:\n${fmtLPs(brandDomain.toLowerCase())}` : `BRAND: ${brandDomain} (no data)`;

  const compBlocks = competitors.map(c => `${c.domain}${c.parentCompany ? ` (${c.parentCompany})` : ''}${c.productLine ? ` — ${c.productLine}` : ''}:
- Impressions: ${fmtM(c.totalImpressions)} (SOV: ${((c.totalImpressions / totalImps) * 100).toFixed(1)}%)
- Spend: $${fmtM(c.totalSpend)} | CPM: ${cpm(c)}
- Channels: ${fmtChannels(c)}
- Top Creatives:\n${fmtCreatives(c)}
- Top Publishers:\n${fmtPubs(c.domain)}
- Landing Pages:\n${fmtLPs(c.domain)}`).join('\n\n');

  return `Competitive advertising analysis for "${brandDomain}" — 3-month rolling window.

${brandBlock}

COMPETITORS:
${compBlocks || 'No competitor data.'}

Analyze this data and return structured JSON insights.`;
}

export const config: Config = { background: true };
