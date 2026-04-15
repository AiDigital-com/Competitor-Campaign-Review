/**
 * Lambda 3a: CAMPAIGN DETAIL (parallel)
 * Fetches full campaign + creative detail for verified domains.
 * Writes deterministic campaign data to report_data.
 * Checks if siblings (3b, 3c) are complete → triggers synthesize.
 */
import type { Config } from '@netlify/functions';
import { getAdClarityData } from './_shared/bigquery.js';
import {
  getSupabase, mergeReportData, setStep, insertTasks,
  areSiblingsComplete, markError,
} from './_shared/pipeline.js';

const SIBLINGS = ['ccr_campaign_detail', 'ccr_firecrawl', 'ccr_publishers'];

export default async (req: Request) => {
  const { sessionId, jobId, brandDomain, userId, verifiedDomains, annotations, topCampaigns } = await req.json();
  const supabase = getSupabase();

  try {
    await setStep(supabase, jobId, 'Fetching campaign detail…');

    // Full AdClarity data for brand + verified competitors
    const allDomains = [brandDomain.toLowerCase(), ...verifiedDomains];
    const adData = await getAdClarityData(allDomains);

    // Apply annotations
    const brandKey = brandDomain.toLowerCase();
    const brand = adData.find(d => d.domain === brandKey) || {
      domain: brandKey, totalImpressions: 0, totalSpend: 0,
      channels: [], publishers: [], creatives: [],
    };

    const competitors = adData
      .filter(d => d.domain !== brandKey)
      .map(d => {
        const ann = annotations?.[d.domain];
        if (ann) { d.parentCompany = ann.parentCompany; d.productLine = ann.productLine; }
        return d;
      })
      .sort((a, b) => b.totalImpressions - a.totalImpressions)
      .slice(0, 5);

    // Apply brand annotations
    const brandAnn = annotations?.[brandKey];
    if (brandAnn) { brand.parentCompany = brandAnn.parentCompany; brand.productLine = brandAnn.productLine; }

    // Write deterministic report — comparison table + campaign grid can render
    await mergeReportData(supabase, sessionId, {
      phase: 'campaigns',
      brand,
      competitors,
      topCampaigns,
      generatedAt: new Date().toISOString(),
    });

    console.log(`[campaign-detail] Brand: ${brand.domain} (${brand.totalImpressions} imps), ${competitors.length} competitors`);

    // Check if siblings are done → trigger synthesize
    try {
      console.log('[campaign-detail] Checking siblings for session:', sessionId);
      const done = await areSiblingsComplete(supabase, sessionId, SIBLINGS);
      console.log('[campaign-detail] Siblings complete:', done);
      if (done) {
        await insertTasks(supabase, sessionId, [{
          taskType: 'ccr_synthesize',
          payload: { sessionId, jobId, brandDomain, userId },
        }]);
        console.log('[campaign-detail] ccr_synthesize inserted');
      }
    } catch (sibErr) {
      console.error('[campaign-detail] Sibling check failed:', sibErr);
      await supabase.from('pipeline_tasks')
        .update({ result: { siblingError: String(sibErr) } })
        .eq('scan_id', sessionId)
        .eq('task_type', 'ccr_campaign_detail');
    }

  } catch (err) {
    console.error('[campaign-detail] Error:', err);
    await markError(supabase, sessionId, jobId, err as Error);
  }
};

export const config: Config = { background: true };
