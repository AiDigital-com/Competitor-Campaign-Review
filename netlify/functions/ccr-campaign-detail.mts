/**
 * Lambda 3a: CAMPAIGN DETAIL (parallel)
 * Fetches full campaign + creative detail for verified domains.
 * LLM filters campaigns by product-line relevance — recalculates metrics from filtered set.
 * Writes deterministic campaign data to report_data.
 */
import type { Config } from '@netlify/functions';
import { createLLMProvider } from '@AiDigital-com/design-system/server';
import { getAdClarityData, getCampaignDetailExhaustive } from './_shared/bigquery.js';
import {
  getSupabase, mergeReportData, setStep, insertTasks,
  isPhase3DataComplete, markError, APP_NAME,
} from './_shared/pipeline.js';
import type { CampaignData } from '../../src/lib/types.js';

export default async (req: Request) => {
  const { jobId, brandDomain, brandProductLine, userId, verifiedDomains, annotations, topCampaigns } = await req.json();
  const supabase = getSupabase();

  try {
    await setStep(supabase, jobId, 'Fetching campaign detail…');

    // Full AdClarity data for brand + verified competitors
    // Exhaustive fetch: windowed per-domain (50 campaigns each, single BQ scan)
    // Gives LLM the full 3-month rolling window to classify, not a skimmed global top-N
    const brandKey = brandDomain.toLowerCase();
    const allDomains = [brandKey, ...verifiedDomains];
    const [adData, allCampaigns] = await Promise.all([
      getAdClarityData(allDomains),
      getCampaignDetailExhaustive(allDomains, 50),
    ]);

    // Group campaigns by domain
    const campaignsByDomain = new Map<string, any[]>();
    for (const c of allCampaigns) {
      const d = c.advertiser_domain;
      if (!campaignsByDomain.has(d)) campaignsByDomain.set(d, []);
      campaignsByDomain.get(d)!.push(c);
    }

    // LLM: classify each competitor's campaigns as product-relevant or not
    await setStep(supabase, jobId, 'Filtering campaigns by product line…');
    const relevantCampaigns = new Map<string, Set<string>>();

    if (brandProductLine) {
      const llm = createLLMProvider('gemini', process.env.GEMINI_API_KEY!, 'fast', { supabase });

      // Build campaign list for LLM — all competitor campaigns
      const campList: { domain: string; campaign: string }[] = [];
      for (const domain of verifiedDomains) {
        const camps = campaignsByDomain.get(domain) || [];
        const seen = new Set<string>();
        for (const c of camps) {
          const name = c.creative_campaign_name;
          if (name && !seen.has(name)) {
            seen.add(name);
            campList.push({ domain, campaign: name });
          }
        }
      }

      if (campList.length > 0) {
        try {
          const result = await llm.generateContent({
            system: `You filter advertising campaigns by product-line relevance.
The brand sells: "${brandProductLine}".
For each campaign, decide if it promotes a SIMILAR product/service.
Return ONLY valid JSON array — no markdown:
[{"domain":"...","campaign":"...","relevant":true/false}]
- relevant=true: campaign promotes a product that competes with "${brandProductLine}"
- relevant=false: campaign promotes a different product (e.g. car insurance vs retirement planning)
Be strict — only keep campaigns that are genuinely competing for the same customer need.`,
            userParts: [{ text: campList.map(c => `${c.domain}: "${c.campaign}"`).join('\n') }],
            app: `${APP_NAME}:filter-campaigns`,
            userId,
            jsonMode: true,
          });

          let classified: { domain: string; campaign: string; relevant: boolean }[] = [];
          try {
            classified = JSON.parse(result.text);
          } catch {
            const match = result.text.match(/\[[\s\S]*\]/);
            if (match) classified = JSON.parse(match[0]);
          }

          for (const c of classified) {
            if (c.relevant) {
              const d = c.domain.toLowerCase();
              if (!relevantCampaigns.has(d)) relevantCampaigns.set(d, new Set());
              relevantCampaigns.get(d)!.add(c.campaign);
            }
          }
          console.log(`[campaign-detail] LLM filtered: ${classified.filter(c => c.relevant).length}/${classified.length} campaigns relevant`);
        } catch (err) {
          console.warn('[campaign-detail] Campaign filter LLM failed, keeping all:', err);
        }
      }
    }

    // Build CampaignData with filtered metrics
    const adDataMap = new Map(adData.map(d => [d.domain, d]));

    function buildFiltered(domain: string): CampaignData {
      const raw = adDataMap.get(domain);
      const domainCampaigns = campaignsByDomain.get(domain) || [];
      const relevant = relevantCampaigns.get(domain);

      // If no filter (brand itself, or LLM didn't run), use all data
      if (!relevant || domain === brandKey) {
        return raw || { domain, totalImpressions: 0, totalSpend: 0, channels: [], publishers: [], creatives: [] };
      }

      // Filter campaigns to relevant ones and recalculate metrics
      const keptCampaigns = domainCampaigns.filter(c => relevant.has(c.creative_campaign_name));
      const totalImpressions = keptCampaigns.reduce((s, c) => s + (Number(c.impressions) || 0), 0);
      const totalSpend = keptCampaigns.reduce((s, c) => s + (Number(c.spend) || 0), 0);

      // Rebuild channel breakdown from filtered campaigns
      const channelMap = new Map<string, { impressions: number; spend: number }>();
      for (const c of keptCampaigns) {
        const ch = c.channel_name || 'Unknown';
        const existing = channelMap.get(ch) ?? { impressions: 0, spend: 0 };
        channelMap.set(ch, {
          impressions: existing.impressions + (Number(c.impressions) || 0),
          spend: existing.spend + (Number(c.spend) || 0),
        });
      }
      const channels = Array.from(channelMap.entries())
        .map(([name, d]) => ({ name, impressions: d.impressions, spend: d.spend }))
        .sort((a, b) => b.impressions - a.impressions);

      // Filter creatives to only those from relevant campaigns
      const keptCampNames = new Set(keptCampaigns.map(c => c.creative_campaign_name));
      const filteredCreatives = (raw?.creatives || []).filter(c =>
        !c.campaignName || keptCampNames.has(c.campaignName)
      );

      return {
        domain,
        totalImpressions,
        totalSpend,
        channels,
        publishers: raw?.publishers || [],
        creatives: filteredCreatives,
        parentCompany: raw?.parentCompany,
        productLine: raw?.productLine,
      };
    }

    const brand = buildFiltered(brandKey);
    const brandAnn = annotations?.[brandKey];
    if (brandAnn) { brand.parentCompany = brandAnn.parentCompany; brand.productLine = brandAnn.productLine; }

    const competitors = verifiedDomains
      .map((d: string) => {
        const comp = buildFiltered(d);
        const ann = annotations?.[d];
        if (ann) { comp.parentCompany = ann.parentCompany; comp.productLine = ann.productLine; }
        return comp;
      })
      .filter((d: CampaignData) => d.totalImpressions > 0)
      .sort((a: CampaignData, b: CampaignData) => b.totalImpressions - a.totalImpressions)
      .slice(0, 5);

    // Write to report_data
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
