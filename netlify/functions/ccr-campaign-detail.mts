/**
 * Lambda 3a: CAMPAIGN DETAIL (parallel)
 *
 * Optimized BQ flow — creatives deferred until AFTER LLM filtering:
 * 1. Fetch campaigns (windowed per-domain) + summary metrics — LIGHT scans
 * 2. LLM classifies campaigns by product-line relevance
 * 3. Fetch creatives ONLY for surviving campaigns (Gate A: campaign name filter, Gate B: skip empty domains)
 * 4. Recalculate metrics from filtered set, write to report_data
 */
import type { Config } from '@netlify/functions';
import { createLLMProvider } from '@AiDigital-com/design-system/server';
import { getAdSummary, getCampaignDetailFull, getCreativesForCampaigns } from './_shared/bigquery.js';
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

    // ── Step 1: LIGHT scans — campaigns + summary only (no creatives) ───────
    const brandKey = brandDomain.toLowerCase();
    const allDomains = [brandKey, ...verifiedDomains];
    const [summaryRows, allCampaigns] = await Promise.all([
      getAdSummary(allDomains),
      getCampaignDetailFull(allDomains),
    ]);

    // Group campaigns by domain
    const campaignsByDomain = new Map<string, any[]>();
    for (const c of allCampaigns) {
      const d = c.advertiser_domain;
      if (!campaignsByDomain.has(d)) campaignsByDomain.set(d, []);
      campaignsByDomain.get(d)!.push(c);
    }

    // ── Step 2: LLM campaign filtering ──────────────────────────────────────
    await setStep(supabase, jobId, 'Filtering campaigns by product line…');
    const relevantCampaigns = new Map<string, Set<string>>();

    if (brandProductLine) {
      const llm = createLLMProvider('gemini', process.env.GEMINI_API_KEY!, 'fast', { supabase });

      // Build campaign list for LLM — all competitor campaigns (unique names only)
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

    // ── Step 3: DEFERRED creative fetch — only for surviving campaigns ──────
    // Gate B: build map of domain → relevant campaign names (skip domains with 0)
    // Gate A: campaign name filter in BQ WHERE clause
    await setStep(supabase, jobId, 'Fetching creatives for relevant campaigns…');

    const creativeFetchMap = new Map<string, string[]>();
    // Brand: all campaigns (no filtering)
    const brandCamps = campaignsByDomain.get(brandKey) || [];
    const brandCampNames = [...new Set(brandCamps.map(c => c.creative_campaign_name).filter(Boolean))];
    if (brandCampNames.length > 0) creativeFetchMap.set(brandKey, brandCampNames);

    // Competitors: only relevant campaigns
    for (const domain of verifiedDomains) {
      const relevant = relevantCampaigns.get(domain);
      if (relevant && relevant.size > 0) {
        creativeFetchMap.set(domain, [...relevant]);
      } else if (!brandProductLine) {
        // No filtering applied — fetch all campaigns for this domain
        const camps = campaignsByDomain.get(domain) || [];
        const names = [...new Set(camps.map(c => c.creative_campaign_name).filter(Boolean))];
        if (names.length > 0) creativeFetchMap.set(domain, names);
      }
    }

    const creativeRows = await getCreativesForCampaigns(creativeFetchMap, 20);

    // Group creatives by domain
    const creativesByDomain = new Map<string, any[]>();
    for (const c of creativeRows) {
      const d = c.advertiser_domain;
      if (!creativesByDomain.has(d)) creativesByDomain.set(d, []);
      creativesByDomain.get(d)!.push(c);
    }

    console.log(`[campaign-detail] Creatives fetched: ${creativeRows.length} rows for ${creativeFetchMap.size} domains (skipped ${allDomains.length - creativeFetchMap.size} empty)`);

    // ── Step 4: Build CampaignData with filtered metrics ────────────────────
    const summaryMap = new Map(summaryRows.map(s => [s.advertiser_domain, s]));

    function buildFiltered(domain: string): CampaignData {
      const summary = summaryMap.get(domain);
      const domainCampaigns = campaignsByDomain.get(domain) || [];
      const relevant = relevantCampaigns.get(domain);
      const domainCreatives = (creativesByDomain.get(domain) || []).slice(0, 20).map(c => ({
        id: String(c.creative_id || ''),
        url: c.creative_url_supplier || '',
        mimeType: c.creative_mime_type || '',
        channelName: c.channel_name || '',
        firstSeen: c.first_seen || '',
        impressions: Number(c.impressions) || 0,
        spend: Number(c.spend) || 0,
        campaignName: c.creative_campaign_name || '',
      }));

      // If no filter (brand itself, or LLM didn't run), use summary-level data
      if (!relevant || domain === brandKey) {
        const imp = Number(summary?.impressions) || 0;
        const spend = Number(summary?.spend) || 0;
        const total = imp || 1;
        const channels: CampaignData['channels'] = [];
        if (summary) {
          const chMap: Record<string, number> = {
            Display: Number(summary.display_impressions) || 0,
            Video: Number(summary.video_impressions) || 0,
            Social: Number(summary.social_impressions) || 0,
            CTV: Number(summary.ctv_impressions) || 0,
          };
          for (const [name, chImp] of Object.entries(chMap)) {
            if (chImp > 0) channels.push({ name, impressions: chImp, spend: Math.round(spend * chImp / total) });
          }
          channels.sort((a, b) => b.impressions - a.impressions);
        }
        return { domain, totalImpressions: imp, totalSpend: spend, channels, publishers: [], creatives: domainCreatives };
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

      // Creatives already filtered by campaign name in BQ query (Gate A)
      return {
        domain, totalImpressions, totalSpend, channels,
        publishers: [],
        creatives: domainCreatives,
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
