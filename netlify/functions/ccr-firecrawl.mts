/**
 * Lambda 3b: FIRECRAWL (parallel)
 * Crawls actual campaign landing pages (from campaign_channel_detail URLs).
 * Saves full output: screenshot, title, description, markdown content.
 * Screenshot shows as 3rd element in campaign card (after top 2 creatives).
 * Markdown content feeds into Lambda 4 SYNTHESIZE for LLM analysis.
 */
import type { Config } from '@netlify/functions';
import { scrapeUrl } from './_shared/firecrawl.js';
import {
  getSupabase, mergeReportData, setStep, insertTasks,
  isPhase3DataComplete, markError,
} from './_shared/pipeline.js';

interface LandingPageInsight {
  url: string;
  campaignName: string;
  domain: string;
  title?: string;
  description?: string;
  screenshotUrl?: string;
  markdown?: string;
}

export default async (req: Request) => {
  const { jobId, brandDomain, userId, verifiedDomains, topCampaigns } = await req.json();
  const supabase = getSupabase();

  try {
    await setStep(supabase, jobId, 'Crawling landing pages…');

    // Collect actual campaign landing page URLs from topCampaigns (attached by ccr-verify)
    const allDomains = [brandDomain.toLowerCase(), ...verifiedDomains];
    const crawlTargets: { url: string; campaignName: string; domain: string }[] = [];

    for (const domain of allDomains) {
      const campaigns = topCampaigns?.[domain] || [];
      for (const camp of campaigns.slice(0, 3)) {
        const lpUrl = camp.landing_page_url;
        if (lpUrl && !crawlTargets.some(t => t.url === lpUrl)) {
          crawlTargets.push({
            url: lpUrl,
            campaignName: camp.creative_campaign_name || 'Unknown',
            domain,
          });
        }
      }
    }

    // Crawl in parallel (max 12 — top 3 campaigns × ~4 brands with LP data)
    const targets = crawlTargets.slice(0, 12);
    console.log(`[firecrawl] Crawling ${targets.length} landing pages`);
    targets.forEach(t => console.log(`  ${t.domain}: ${t.url.substring(0, 80)}`));

    const results = await Promise.allSettled(
      targets.map(async (target) => {
        const scrape = await scrapeUrl(target.url);
        return {
          url: target.url,
          campaignName: target.campaignName,
          domain: target.domain,
          title: scrape?.title || undefined,
          description: scrape?.description || undefined,
          screenshotUrl: scrape?.screenshotUrl || undefined,
          markdown: scrape?.markdown?.substring(0, 3000) || undefined, // cap for payload size
        } as LandingPageInsight;
      })
    );

    const landingPages: LandingPageInsight[] = results
      .filter((r): r is PromiseFulfilledResult<LandingPageInsight> => r.status === 'fulfilled')
      .map(r => r.value);

    console.log(`[firecrawl] ${landingPages.length}/${targets.length} pages crawled`);
    landingPages.forEach(lp => console.log(`  ${lp.domain}: title="${lp.title?.substring(0, 50)}" screenshot=${!!lp.screenshotUrl}`));

    // Track Firecrawl API cost
    if (landingPages.length > 0) {
      const { logTokenUsage, detectSource } = await import('@AiDigital-com/design-system/logger');
      const { getUserOrgId } = await import('@AiDigital-com/design-system/access');
      const orgId = await getUserOrgId(supabase as any, userId).catch(() => null);
      logTokenUsage(supabase as any, {
        userId, orgId, app: 'competitor-campaign-review:firecrawl', source: detectSource(userId),
        aiProvider: 'firecrawl', aiModel: 'scrape-v1',
        inputTokens: 0, outputTokens: landingPages.length, totalTokens: landingPages.length,
      }).catch(() => {});
    }

    // Write to report_data
    await mergeReportData(supabase, jobId, { landingPages });

    // Check if all Phase 3 data is present → trigger synthesize
    if (await isPhase3DataComplete(supabase, jobId)) {
      await insertTasks(supabase, jobId, [{
        taskType: 'ccr_synthesize',
        payload: { jobId, brandDomain, userId },
      }]);
    }

  } catch (err) {
    console.error('[firecrawl] Error:', err);
    await markError(supabase, jobId, jobId, err as Error);
  }
};

export const config: Config = { background: true };
