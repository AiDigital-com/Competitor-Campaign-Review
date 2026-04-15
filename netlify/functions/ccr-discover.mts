/**
 * Lambda 1: DISCOVER
 * DataForSeo competitor discovery + AdClarity summary fetch for all candidates.
 * Output: candidate domains with summary metrics → inserts ccr_verify task.
 */
import type { Config } from '@netlify/functions';
import { getCompetitorDomains } from './_shared/dataforseo.js';
import { discoverAdCompetitors, getAdClarityData } from './_shared/bigquery.js';
import { getSupabase, mergeReportData, setStep, insertTasks, markError } from './_shared/pipeline.js';
import { log } from './_shared/logger.js';

export default async (req: Request) => {
  // Standard N-Lambda payload: jobId = sessionId (single ID)
  const body = await req.json();
  const jobId = body.jobId;
  const userId = body.userId;
  const brandDomain = body.intakeSummary?.brand_domain || body.brandDomain;
  const supabase = getSupabase();

  try {
    // Session + job_status already created by dispatch-pipeline (createDispatchHandler)

    // Two parallel signals: SEO competitors + ad-spend competitors
    const [seoResult, adResult] = await Promise.allSettled([
      getCompetitorDomains(brandDomain).catch(() => [] as string[]),
      discoverAdCompetitors(brandDomain, 10),
    ]);

    const seoDomains = seoResult.status === 'fulfilled' ? seoResult.value : [];
    const adDomains = adResult.status === 'fulfilled' ? adResult.value : [];

    // Track DataForSeo API cost (1 unit = 1 competitor_domain call)
    if (seoDomains.length > 0) {
      const { logTokenUsage, detectSource } = await import('@AiDigital-com/design-system/logger');
      const { getUserOrgId } = await import('@AiDigital-com/design-system/access');
      const orgId = await getUserOrgId(supabase as any, userId).catch(() => null);
      logTokenUsage(supabase as any, {
        userId, orgId, app: 'competitor-campaign-review:dataforseo', source: detectSource(userId),
        aiProvider: 'dataforseo', aiModel: 'competitors-domain',
        inputTokens: 0, outputTokens: 1, totalTokens: 1,
      }).catch(() => {});
    }

    // Merge: ad competitors first (they have data), then SEO
    const seen = new Set<string>([brandDomain.toLowerCase()]);
    const candidateDomains: string[] = [];
    for (const d of [...adDomains, ...seoDomains]) {
      const lower = d.toLowerCase();
      if (!seen.has(lower)) { seen.add(lower); candidateDomains.push(lower); }
    }

    console.log(`[discover] ${adDomains.length} ad + ${seoDomains.length} SEO → ${candidateDomains.length} candidates`);

    // Fetch summary-level AdClarity data for brand + all candidates
    await setStep(supabase, jobId, 'Fetching ad summaries…');
    const allDomains = [brandDomain.toLowerCase(), ...candidateDomains];
    const summaryData = await getAdClarityData(allDomains);

    // Write partial report — candidates with summaries
    const summaryMap: Record<string, any> = {};
    for (const d of summaryData) {
      summaryMap[d.domain] = {
        domain: d.domain,
        totalImpressions: d.totalImpressions,
        totalSpend: d.totalSpend,
        channels: d.channels,
      };
    }

    await mergeReportData(supabase, jobId, {
      phase: 'discover',
      brandDomain: brandDomain.toLowerCase(),
      candidateDomains,
      summaries: summaryMap,
    });

    log.info('ccr-discover.complete', {
      function_name: 'ccr-discover',
      user_id: userId,
      entity_id: jobId,
      meta: { candidateCount: candidateDomains.length, withData: summaryData.length },
    });

    // Insert next task: VERIFY (gate)
    await insertTasks(supabase, jobId, [{
      taskType: 'ccr_verify',
      payload: { jobId, brandDomain, userId, candidateDomains, summaries: summaryMap },
    }]);

  } catch (err) {
    console.error('[discover] Error:', err);
    await markError(supabase, jobId, jobId, err as Error);
  }
};

export const config: Config = { background: true };
