/**
 * Lambda 1: DISCOVER
 * DataForSeo competitor discovery + AdClarity summary fetch for all candidates.
 * Output: candidate domains with summary metrics → inserts ccr_verify task.
 */
import type { Config } from '@netlify/functions';
import { getCompetitorDomains } from './_shared/dataforseo.js';
import { discoverAdCompetitors, getAdSummary, getCampaignDetail } from './_shared/bigquery.js';
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
    const adCandidates = adResult.status === 'fulfilled' ? adResult.value : [];

    // Track DataForSeo API cost
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

    // Merge: ad competitors first (they have campaign data), then SEO
    const seen = new Set<string>([brandDomain.toLowerCase()]);
    const candidateDomains: string[] = [];
    // Build campaign lookup from ad candidates (BQ provides top campaigns per domain)
    const candidateCampaigns: Record<string, string[]> = {};
    for (const c of adCandidates) {
      const lower = c.domain.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        candidateDomains.push(lower);
        candidateCampaigns[lower] = c.topCampaigns;
      }
    }
    for (const d of seoDomains) {
      const lower = d.toLowerCase();
      if (!seen.has(lower)) { seen.add(lower); candidateDomains.push(lower); }
    }

    console.log(`[discover] ${adCandidates.length} ad + ${seoDomains.length} SEO → ${candidateDomains.length} candidates`);

    // Fetch brand's top campaigns (for product-line classification in verify step)
    const brandCamps = await getCampaignDetail([brandDomain.toLowerCase()], 5);
    candidateCampaigns[brandDomain.toLowerCase()] = brandCamps
      .map(c => (c.creative_campaign_name || '').replace(/\s+\d{7,}$/, ''))
      .filter((v: string, i: number, a: string[]) => v && a.indexOf(v) === i)
      .slice(0, 5);

    // Fetch ONLY summary metrics — no creatives or publishers needed at discovery stage
    // Saves 2 heavy BQ scans (creative detail + publisher data) per run
    await setStep(supabase, jobId, 'Fetching ad summaries…');
    const allDomains = [brandDomain.toLowerCase(), ...candidateDomains];
    const summaryRows = await getAdSummary(allDomains);

    // Build summary map from raw summary rows
    const summaryMap: Record<string, any> = {};
    for (const s of summaryRows) {
      const domain = s.advertiser_domain;
      const imp = Number(s.impressions) || 0;
      const spend = Number(s.spend) || 0;
      const channels: { name: string; impressions: number; spend: number }[] = [];
      const total = imp || 1;
      const chMap: Record<string, number> = {
        Display: Number(s.display_impressions) || 0,
        Video: Number(s.video_impressions) || 0,
        Social: Number(s.social_impressions) || 0,
        CTV: Number(s.ctv_impressions) || 0,
      };
      for (const [name, chImp] of Object.entries(chMap)) {
        if (chImp > 0) channels.push({ name, impressions: chImp, spend: Math.round(spend * chImp / total) });
      }
      channels.sort((a, b) => b.impressions - a.impressions);
      summaryMap[domain] = { domain, totalImpressions: imp, totalSpend: spend, channels };
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
      meta: { candidateCount: candidateDomains.length, withData: summaryRows.length },
    });

    // Insert next task: VERIFY (gate)
    await insertTasks(supabase, jobId, [{
      taskType: 'ccr_verify',
      payload: { jobId, brandDomain, userId, candidateDomains, candidateCampaigns, summaries: summaryMap },
    }]);

  } catch (err) {
    console.error('[discover] Error:', err);
    await markError(supabase, jobId, jobId, err as Error);
  }
};

export const config: Config = { background: true };
