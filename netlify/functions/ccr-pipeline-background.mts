/**
 * CCR Pipeline — background function.
 *
 * 5-step pipeline:
 * 1. DataForSeo → discover competitor domains
 * 2. BigQuery/AdClarity → fetch campaign intelligence for brand + competitors
 * 3. Firecrawl → scrape homepages, capture screenshots, verify industry match
 * 4. LLM narrative → strategic analysis
 * 5. Write report to job_status + ccr_sessions
 *
 * All LLM calls go through createLLMProvider (DS wrapper).
 * Writes progress to job_status via writeJobStatus (Realtime-subscribed by frontend).
 */
import type { Config } from '@netlify/functions';
import { createLLMProvider } from '@AiDigital-com/design-system/server';
import { createClient } from '@supabase/supabase-js';
import { getCompetitorDomains } from './_shared/dataforseo.js';
import { getAdClarityData, discoverAdCompetitors } from './_shared/bigquery.js';
import { scrapeUrl } from './_shared/firecrawl.js';
import { log } from './_shared/logger.js';
import type { CcrReportData, CampaignData, CcrInsights } from '../../src/lib/types.js';

const APP_NAME = 'competitor-campaign-review';

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = await req.json();
  const { sessionId, jobId, intakeData, userId, userEmail } = body as {
    sessionId: string;
    jobId: string;
    intakeData: { brand_domain: string; source: string };
    userId: string | null;
    userEmail: string | null;
  };

  if (!jobId || !sessionId || !intakeData?.brand_domain) {
    return new Response('Missing required fields', { status: 400 });
  }

  const { brand_domain } = intakeData;
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const startTime = Date.now();

  // Ensure session row exists (frontend upsert may fail due to RLS timing)
  await supabase.from('ccr_sessions').upsert({
    id: sessionId,
    user_id: userId,
    brand_name: brand_domain,
    status: 'processing',
    job_id: jobId,
    intake_summary: intakeData,
    deleted_by_user: false,
  }, { onConflict: 'id' });

  // Immediately mark job as started so frontend sees activity
  await supabase.from('job_status').upsert({
    id: jobId,
    app: APP_NAME,
    status: 'streaming',
    meta: { current_step: 'Discovering competitors…' },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });

  const setStep = async (step: string) => {
    await supabase.from('job_status').update({
      meta: { current_step: step },
      updated_at: new Date().toISOString(),
    }).eq('id', jobId);
  };

  try {
    log.info('ccr-pipeline.start', {
      function_name: 'ccr-pipeline-background',
      user_id: userId,
      user_email: userEmail,
      entity_type: 'session',
      entity_id: sessionId,
      correlation_id: jobId,
      meta: { brand_domain },
    });

    // ── Step 1: Discover competitors (DataForSeo + AdClarity) ─────────────
    await setStep('Discovering competitors…');

    // Two parallel signals: SEO competitors + ad-spend competitors
    const [seoCompetitors, adCompetitors] = await Promise.allSettled([
      getCompetitorDomains(brand_domain).catch(() => [] as string[]),
      discoverAdCompetitors(brand_domain, 10),
    ]);

    const seoDomains = seoCompetitors.status === 'fulfilled' ? seoCompetitors.value : [];
    const adDomains = adCompetitors.status === 'fulfilled' ? adCompetitors.value : [];

    // Merge: ad competitors first (they have data), then SEO competitors
    const seen = new Set<string>([brand_domain.toLowerCase()]);
    const competitorDomains: string[] = [];
    for (const d of [...adDomains, ...seoDomains]) {
      const lower = d.toLowerCase();
      if (!seen.has(lower)) { seen.add(lower); competitorDomains.push(lower); }
    }
    console.log(`Competitors: ${adDomains.length} ad + ${seoDomains.length} SEO → ${competitorDomains.length} unique`);

    // ── Step 1b: LLM competitor verification (Brand + Product annotation) ───
    await setStep('Verifying competitors…');
    const llmVerify = createLLMProvider('gemini', process.env.GEMINI_API_KEY!, 'fast', { supabase });
    let verifiedCompetitors: { domain: string; parentCompany: string; productLine: string; keep: boolean }[] = [];
    try {
      const verifyResult = await llmVerify.generateContent({
        system: `You classify advertising domains. Return ONLY valid JSON array — no markdown, no code fences.
Each element: {"domain":"...","parentCompany":"...","productLine":"...","keep":true/false}
Rules:
- parentCompany: the owning corporation (e.g. "PepsiCo" for both pepsi.com and pepsico.com)
- productLine: the specific product focus of this domain (e.g. "Core Pepsi beverages" vs "Muscle Milk / corporate")
- keep: false ONLY if the domain is clearly not a competitor (e.g. social media platforms, search engines). Keep both if same parent company but different product lines.
- Do NOT remove domains just because they share a parent company — they represent distinct ad strategies.`,
        userParts: [{ text: `Brand being analyzed: ${brand_domain}\nCompetitor domains to verify:\n${competitorDomains.map(d => `- ${d}`).join('\n')}` }],
        app: `${APP_NAME}:verify-competitors`,
        userId: userId ?? undefined,
        jsonMode: true,
      });
      try {
        verifiedCompetitors = JSON.parse(verifyResult.text);
      } catch {
        const match = verifyResult.text.match(/\[[\s\S]*\]/);
        if (match) verifiedCompetitors = JSON.parse(match[0]);
      }
      console.log(`Verified: ${verifiedCompetitors.length} competitors, ${verifiedCompetitors.filter(c => c.keep).length} kept`);
    } catch (err) {
      console.warn('Competitor verification failed, using unverified list:', err);
      verifiedCompetitors = competitorDomains.map(d => ({ domain: d, parentCompany: '', productLine: '', keep: true }));
    }

    // Filter to kept competitors, store annotations for report
    const competitorAnnotations = new Map(verifiedCompetitors.map(c => [c.domain.toLowerCase(), c]));
    const filteredCompetitors = verifiedCompetitors.filter(c => c.keep).map(c => c.domain.toLowerCase());

    // ── Step 2: AdClarity (BQ query → Supabase training → BQ scan) ────────
    await setStep('Fetching ad intelligence…');
    const allDomains = [brand_domain, ...filteredCompetitors].slice(0, 11); // brand + up to 10
    let adData: CampaignData[] = [];
    try {
      adData = await getAdClarityData(allDomains);
      console.log(`AdClarity: ${adData.length} domains with data`);
    } catch (err) {
      console.warn('AdClarity cascade failed:', err);
    }

    // Build lookup map
    const adDataByDomain = new Map<string, CampaignData>(adData.map(d => [d.domain, d]));

    // ── Step 3: Firecrawl — scrape & screenshot ───────────────────────────────
    await setStep('Capturing screenshots…');

    // Scrape brand + top 5 competitors in parallel
    const domainsToScrape = [brand_domain, ...competitorDomains.slice(0, 5)];
    const scrapeResults = await Promise.allSettled(
      domainsToScrape.map(d => scrapeUrl(d))
    );

    // Merge scrape data into campaign entries
    const mergedData = new Map<string, CampaignData>();
    domainsToScrape.forEach((domain, idx) => {
      const existing = adDataByDomain.get(domain.toLowerCase()) ?? {
        domain: domain.toLowerCase(),
        totalImpressions: 0,
        totalSpend: 0,
        channels: [],
        publishers: [],
        creatives: [],
      };
      const scrape = scrapeResults[idx].status === 'fulfilled' ? scrapeResults[idx].value : null;
      mergedData.set(domain.toLowerCase(), {
        ...existing,
        screenshotUrl: scrape?.screenshotUrl ?? null,
        scrapedTitle: scrape?.title ?? null,
        scrapedDescription: scrape?.description ?? null,
      });
    });

    // Also include any AdClarity-only domains not in scrape list
    for (const [d, data] of adDataByDomain) {
      if (!mergedData.has(d)) mergedData.set(d, data);
    }

    // ── Build brand + competitor CampaignData ────────────────────────────────
    const brandKey = brand_domain.toLowerCase();
    const brandData: CampaignData = mergedData.get(brandKey) ?? {
      domain: brandKey,
      totalImpressions: 0,
      totalSpend: 0,
      channels: [],
      publishers: [],
      creatives: [],
    };

    // Apply LLM annotations (parentCompany + productLine)
    const brandAnnotation = competitorAnnotations.get(brandKey);
    if (brandAnnotation) {
      brandData.parentCompany = brandAnnotation.parentCompany;
      brandData.productLine = brandAnnotation.productLine;
    }

    // Competitors = all other domains, sorted by total impressions desc
    const competitorsData: CampaignData[] = Array.from(mergedData.values())
      .filter(d => d.domain !== brandKey)
      .map(d => {
        const ann = competitorAnnotations.get(d.domain);
        if (ann) { d.parentCompany = ann.parentCompany; d.productLine = ann.productLine; }
        return d;
      })
      .sort((a, b) => b.totalImpressions - a.totalImpressions)
      .slice(0, 5);

    // ── Step 4: LLM narrative ────────────────────────────────────────────────
    await setStep('Generating strategic analysis…');

    const analysisContext = buildAnalysisContext(brand_domain, brandData, competitorsData);
    const llm = createLLMProvider('gemini', process.env.GEMINI_API_KEY!, 'analysis', { supabase });

    const insightsResult = await llm.generateContent({
      system: `You are a competitive intelligence analyst specializing in digital advertising and creative strategy.
Return ONLY valid JSON matching this structure — no markdown, no code fences:
{
  "executiveSummary": "One paragraph (3-5 sentences). Compare the brand's creative performance to competitors with similar budget/channel mix. Reference specific numbers (impressions, spend, CPM). Highlight creative volume and format differences.",
  "creativeActions": [{"action": "short directive", "rationale": "data-backed reason"}],
  "spendingActions": [{"action": "short directive", "rationale": "data-backed reason"}],
  "channelActions": [{"action": "short directive", "rationale": "data-backed reason"}]
}
Rules:
- executiveSummary: Focus on brand vs closest competitor by spend. Compare creative formats (video/display/social/CTV), volume, and CPM efficiency.
- creativeActions: 2-3 actions on creative strategy (format mix, messaging gaps, volume vs. competition).
- spendingActions: 2-3 actions on budget allocation (where to increase/decrease spend, CPM optimization).
- channelActions: 2-3 actions on channel strategy (underweight/overweight channels vs. competition).
- Every rationale MUST cite specific numbers from the data.`,
      userParts: [{ text: analysisContext }],
      app: `${APP_NAME}:insights`,
      userId: userId ?? undefined,
      maxTokens: 4096,
      jsonMode: true,
    });

    let insights: CcrInsights | undefined;
    try {
      insights = JSON.parse(insightsResult.text) as CcrInsights;
    } catch {
      const match = insightsResult.text.match(/\{[\s\S]*\}/);
      if (match) try { insights = JSON.parse(match[0]) as CcrInsights; } catch {}
    }
    const narrative = insights?.executiveSummary || insightsResult.text;

    log.info('ccr-pipeline.insights', {
      function_name: 'ccr-pipeline-background',
      user_id: userId,
      ai_provider: llm.provider,
      ai_model: llm.model,
      ai_input_tokens: insightsResult.usage?.inputTokens,
      ai_output_tokens: insightsResult.usage?.outputTokens,
      ai_total_tokens: insightsResult.usage?.totalTokens,
    });

    // ── Step 5: Save report ──────────────────────────────────────────────────
    const reportData: CcrReportData = {
      brand: brandData,
      competitors: competitorsData,
      narrative,
      insights,
      generatedAt: new Date().toISOString(),
    };

    const reportJson = JSON.stringify(reportData);

    // Update job_status → complete
    await supabase.from('job_status').update({
      status: 'complete',
      report: reportJson,
      meta: { current_step: 'Complete' },
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', jobId);

    // Update ccr_sessions with report + final status
    await supabase.from('ccr_sessions').update({
      status: 'complete',
      report_data: reportData,
      job_id: jobId,
      brand_name: brand_domain,
    }).eq('id', sessionId);

    log.info('ccr-pipeline.complete', {
      function_name: 'ccr-pipeline-background',
      user_id: userId,
      user_email: userEmail,
      entity_type: 'session',
      entity_id: sessionId,
      correlation_id: jobId,
      duration_ms: Date.now() - startTime,
      ai_provider: llm.provider,
      ai_model: llm.model,
    });

  } catch (err) {
    console.error('CCR pipeline error:', err);
    log.error('ccr-pipeline.error', {
      function_name: 'ccr-pipeline-background',
      user_id: userId,
      user_email: userEmail,
      entity_type: 'session',
      entity_id: sessionId,
      correlation_id: jobId,
      error: err,
      duration_ms: Date.now() - startTime,
    });

    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : undefined;
    await supabase.from('job_status').update({
      status: 'error',
      error: `${errMsg}\n---STACK---\n${errStack ?? 'no stack'}`,
      updated_at: new Date().toISOString(),
    }).eq('id', jobId);

    await supabase.from('ccr_sessions').update({
      status: 'error',
    }).eq('id', sessionId);
  }
};

export const config: Config = { background: true };

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtM(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function buildAnalysisContext(
  brand: string,
  brandData: CampaignData,
  competitors: CampaignData[],
): string {
  const fmtChannels = (d: CampaignData) =>
    (d.channels || []).map(c => `${c.name}: ${fmtM(c.impressions)} imps ($${fmtM(c.spend)})`).join(', ') || 'none';

  const fmtCreatives = (d: CampaignData) =>
    (d.creatives || []).slice(0, 5).map(c => {
      const camp = (c.campaignName || (c as any).all_campaigns || '').replace(/\s+\d{7,}$/, '');
      const isVideo = (c.url || '').includes('video') || (c.url || '').endsWith('.mp4');
      return `  - ${isVideo ? 'VIDEO' : 'IMAGE'}: ${fmtM(c.impressions || 0)} imps, $${fmtM(c.spend || 0)} | campaign: "${camp}" | since: ${c.firstSeen || '?'}`;
    }).join('\n') || '  (no creatives)';

  const cpm = (d: CampaignData) => d.totalImpressions > 0 ? `$${((d.totalSpend / d.totalImpressions) * 1000).toFixed(2)}` : 'N/A';

  const all = [brandData, ...competitors];
  const totalImps = all.reduce((s, d) => s + d.totalImpressions, 0) || 1;

  const brandBlock = `BRAND: ${brand}
- Impressions: ${fmtM(brandData.totalImpressions)} (SOV: ${((brandData.totalImpressions / totalImps) * 100).toFixed(1)}%)
- Spend: $${fmtM(brandData.totalSpend)} | CPM: ${cpm(brandData)}
- Channels: ${fmtChannels(brandData)}
- Top Creatives:
${fmtCreatives(brandData)}`;

  const compBlocks = competitors.map(c => `${c.domain}:
- Impressions: ${fmtM(c.totalImpressions)} (SOV: ${((c.totalImpressions / totalImps) * 100).toFixed(1)}%)
- Spend: $${fmtM(c.totalSpend)} | CPM: ${cpm(c)}
- Channels: ${fmtChannels(c)}
- Top Creatives:
${fmtCreatives(c)}`).join('\n\n');

  return `Competitive advertising analysis for "${brand}" — 3-month rolling window.

${brandBlock}

COMPETITORS:
${compBlocks || 'No competitor data.'}

Analyze this data and return structured JSON insights.`;
}
