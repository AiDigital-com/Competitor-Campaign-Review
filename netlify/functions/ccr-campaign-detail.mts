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
  isPhase3DataComplete, markError,
} from './_shared/pipeline.js';


export default async (req: Request) => {
  const { jobId, brandDomain, userId, verifiedDomains, annotations, topCampaigns } = await req.json();
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
    await mergeReportData(supabase, jobId, {
      phase: 'campaigns',
      brand,
      competitors,
      topCampaigns,
      generatedAt: new Date().toISOString(),
    });

    console.log(`[campaign-detail] Brand: ${brand.domain} (${brand.totalImpressions} imps), ${competitors.length} competitors`);

    // Check if all Phase 3 data is present → trigger synthesize
    if (await isPhase3DataComplete(supabase, jobId)) {
      await insertTasks(supabase, jobId, [{
        taskType: 'ccr_synthesize',
        payload: { jobId, brandDomain, userId },
      }]);
    }

  } catch (err) {
    console.error('[campaign-detail] Error:', err);
    await markError(supabase, jobId, jobId, err as Error);
  }
};

export const config: Config = { background: true };
