/**
 * Lambda 3c: PUBLISHERS (parallel)
 * Fetches publisher breakdown for verified domains via unified data access layer.
 * Uses BigQuery in production, Supabase relational tables in dev.
 * Writes publisher data to report_data.
 * Checks if siblings (3a, 3b) are complete → triggers synthesize.
 */
import type { Config } from '@netlify/functions';
import { getPublisherData } from './_shared/bigquery.js';
import {
  getSupabase, mergeReportData, setStep, insertTasks,
  isPhase3DataComplete, markError,
} from './_shared/pipeline.js';


export default async (req: Request) => {
  const { jobId, brandDomain, userId, verifiedDomains } = await req.json();
  const supabase = getSupabase();

  try {
    await setStep(supabase, jobId, 'Analyzing publishers…');

    const allDomains = [brandDomain.toLowerCase(), ...verifiedDomains];
    const rows = await getPublisherData(allDomains, 100);

    // Build publisher map: domain → top publishers (excluding "Other Publishers")
    const publishersByDomain: Record<string, any[]> = {};
    for (const row of rows) {
      const d = row.advertiser_domain;
      if (!publishersByDomain[d]) publishersByDomain[d] = [];
      if (row.publisher_group === 'Other Publishers') continue;
      if (publishersByDomain[d].length >= 10) continue;
      publishersByDomain[d].push({
        publisher: row.publisher_group,
        transactionMethod: row.transaction_method,
        impressions: Number(row.impressions) || 0,
        spend: Number(row.spend) || 0,
        displayImpressions: Number(row.display_impressions) || 0,
        videoImpressions: Number(row.video_impressions) || 0,
        socialImpressions: Number(row.social_impressions) || 0,
        ctvImpressions: Number(row.ctv_impressions) || 0,
      });
    }

    // Ensure every domain has an entry (even if empty) so isPhase3DataComplete passes
    for (const d of allDomains) {
      if (!publishersByDomain[d]) publishersByDomain[d] = [];
    }

    console.log(`[publishers] ${Object.keys(publishersByDomain).length} domains with publisher data`);

    // Write to report_data
    await mergeReportData(supabase, jobId, {
      publishersByDomain,
    });

    // Check if all Phase 3 data is present → trigger synthesize
    if (await isPhase3DataComplete(supabase, jobId)) {
      await insertTasks(supabase, jobId, [{
        taskType: 'ccr_synthesize',
        payload: { jobId, brandDomain, userId },
      }]);
    }

  } catch (err) {
    console.error('[publishers] Error:', err);
    await markError(supabase, jobId, jobId, err as Error);
  }
};

export const config: Config = { background: true };
