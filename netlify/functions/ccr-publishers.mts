/**
 * Lambda 3c: PUBLISHERS (parallel)
 * Fetches publisher breakdown for verified domains from training data.
 * Writes publisher data to report_data.
 * Checks if siblings (3a, 3b) are complete → triggers synthesize.
 */
import type { Config } from '@netlify/functions';
import { createClient as createSupabase } from '@supabase/supabase-js';
import {
  getSupabase, mergeReportData, setStep, insertTasks,
  isPhase3DataComplete, markError,
} from './_shared/pipeline.js';


export default async (req: Request) => {
  const { jobId, brandDomain, userId, verifiedDomains } = await req.json();
  const supabase = getSupabase();

  try {
    await setStep(supabase, jobId, 'Analyzing publishers…');

    const sb = createSupabase(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const allDomains = [brandDomain.toLowerCase(), ...verifiedDomains];

    const { data: rows } = await sb
      .from('ccr_training_data')
      .select('advertiser_domain, data')
      .eq('data_type', 'adv_publisher_channel_method')
      .in('advertiser_domain', allDomains);

    // Build publisher map: domain → top publishers (excluding "Other Publishers")
    const publishersByDomain: Record<string, any[]> = {};
    for (const row of rows || []) {
      const pubs = Array.isArray(row.data) ? row.data : [];
      publishersByDomain[row.advertiser_domain] = pubs
        .filter((p: any) => p.publisher_group !== 'Other Publishers')
        .slice(0, 10)
        .map((p: any) => ({
          publisher: p.publisher_group,
          transactionMethod: p.transaction_method,
          impressions: p.impressions,
          spend: p.spend,
          displayImpressions: p.display_impressions,
          videoImpressions: p.video_impressions,
          socialImpressions: p.social_impressions,
          ctvImpressions: p.ctv_impressions,
        }));
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
