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
  const { sessionId, jobId, brandDomain, userId } = await req.json();
  const supabase = getSupabase();

  try {
    await setStep(supabase, jobId, 'Discovering competitors…');

    // Two parallel signals: SEO competitors + ad-spend competitors
    const [seoResult, adResult] = await Promise.allSettled([
      getCompetitorDomains(brandDomain).catch(() => [] as string[]),
      discoverAdCompetitors(brandDomain, 10),
    ]);

    const seoDomains = seoResult.status === 'fulfilled' ? seoResult.value : [];
    const adDomains = adResult.status === 'fulfilled' ? adResult.value : [];

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

    await mergeReportData(supabase, sessionId, {
      phase: 'discover',
      brandDomain: brandDomain.toLowerCase(),
      candidateDomains,
      summaries: summaryMap,
    });

    log.info('ccr-discover.complete', {
      function_name: 'ccr-discover',
      user_id: userId,
      entity_id: sessionId,
      meta: { candidateCount: candidateDomains.length, withData: summaryData.length },
    });

    // Insert next task: VERIFY (gate)
    await insertTasks(supabase, sessionId, [{
      taskType: 'ccr_verify',
      payload: { sessionId, jobId, brandDomain, userId, candidateDomains, summaries: summaryMap },
    }]);

  } catch (err) {
    console.error('[discover] Error:', err);
    await markError(supabase, sessionId, jobId, err as Error);
  }
};

export const config: Config = { background: true };
