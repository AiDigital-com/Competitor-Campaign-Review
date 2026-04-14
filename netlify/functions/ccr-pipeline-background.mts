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
import { getAdClarityData } from './_shared/bigquery.js';
import { scrapeUrl } from './_shared/firecrawl.js';
import { log } from './_shared/logger.js';
import type { CcrReportData, CampaignData } from '../../src/lib/types.js';

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

    // ── Step 1: Discover competitors ─────────────────────────────────────────
    await setStep('Discovering competitors…');
    let competitorDomains: string[] = [];
    try {
      competitorDomains = await getCompetitorDomains(brand_domain);
    } catch (err) {
      console.warn('DataForSeo failed, continuing without search competitors:', err);
    }

    // ── Step 2: AdClarity (BQ query → Supabase training → BQ scan) ────────
    await setStep('Fetching ad intelligence…');
    const allDomains = [brand_domain, ...competitorDomains].slice(0, 11); // brand + up to 10
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

    // Competitors = all other domains, sorted by total impressions desc
    const competitorsData: CampaignData[] = Array.from(mergedData.values())
      .filter(d => d.domain !== brandKey)
      .sort((a, b) => b.totalImpressions - a.totalImpressions)
      .slice(0, 5);

    // ── Step 4: LLM narrative ────────────────────────────────────────────────
    await setStep('Generating strategic analysis…');

    const narrativeContext = buildNarrativeContext(brand_domain, brandData, competitorsData);
    const llm = createLLMProvider('gemini', process.env.GEMINI_API_KEY!, 'analysis', { supabase });

    const narrativeResult = await llm.generateContent({
      system: `You are a competitive intelligence analyst specializing in digital advertising strategy.
Write concise, actionable insights for marketing professionals.
Format with markdown headers (##) and bullet points. Max 600 words.`,
      prompt: narrativeContext,
      app: `${APP_NAME}:narrative`,
      userId: userId ?? undefined,
      maxTokens: 1024,
    });

    log.info('ccr-pipeline.narrative', {
      function_name: 'ccr-pipeline-background',
      user_id: userId,
      ai_provider: llm.provider,
      ai_model: llm.model,
      ai_input_tokens: narrativeResult.usage.inputTokens,
      ai_output_tokens: narrativeResult.usage.outputTokens,
      ai_total_tokens: narrativeResult.usage.totalTokens,
    });

    // ── Step 5: Save report ──────────────────────────────────────────────────
    const reportData: CcrReportData = {
      brand: brandData,
      competitors: competitorsData,
      narrative: narrativeResult.text,
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

    await supabase.from('job_status').update({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
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

function buildNarrativeContext(
  brand: string,
  brandData: CampaignData,
  competitors: CampaignData[],
): string {
  const brandChannels = (brandData.channels || []).map(c => `${c.name}: ${fmtM(c.impressions)} imps`).join(', ') || 'No channel data';
  const competitorSummaries = competitors.map(c =>
    `${c.domain}: ${fmtM(c.totalImpressions)} imps, $${fmtM(c.totalSpend)} spend — channels: ${(c.channels || []).map(ch => ch.name).join(', ') || 'none'}`
  ).join('\n');

  return `Analyze the competitive advertising landscape for "${brand}" and provide strategic recommendations.

BRAND: ${brand}
- Total Impressions: ${fmtM(brandData.totalImpressions)}
- Estimated Spend: $${fmtM(brandData.totalSpend)}
- Active Channels: ${brandChannels}
- Active Publishers: ${(brandData.publishers || []).slice(0, 5).map(p => p.domain).join(', ') || 'None found'}

TOP COMPETITORS:
${competitorSummaries || 'No competitor ad data found in AdClarity dataset.'}

Provide a strategic analysis covering:
1. Share of voice assessment
2. Channel strategy gaps
3. Publisher opportunities competitors are exploiting
4. Creative and messaging recommendations
5. Budget prioritization suggestions

Be specific and actionable. Reference the actual data above.`;
}
