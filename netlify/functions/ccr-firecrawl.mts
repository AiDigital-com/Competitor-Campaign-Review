/**
 * Lambda 3b: FIRECRAWL (parallel)
 * Crawls top 3 landing pages per brand, extracts messaging/CTA/offers.
 * Writes landing page insights to report_data.
 * Checks if siblings (3a, 3c) are complete → triggers synthesize.
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
}

export default async (req: Request) => {
  const { sessionId, jobId, brandDomain, userId, verifiedDomains, topCampaigns } = await req.json();
  const supabase = getSupabase();

  try {
    await setStep(supabase, jobId, 'Crawling landing pages…');

    // Collect unique landing page URLs from top 3 campaigns per domain
    const allDomains = [brandDomain.toLowerCase(), ...verifiedDomains];
    const crawlTargets: { url: string; campaignName: string; domain: string }[] = [];

    for (const domain of allDomains) {
      const campaigns = topCampaigns?.[domain] || [];
      for (const camp of campaigns.slice(0, 3)) {
        // Landing page comes from campaign_channel_detail training data
        // For now, construct from domain if not available
        const lpUrl = camp.landing_page_url || `https://${domain}`;
        if (lpUrl && !crawlTargets.some(t => t.url === lpUrl)) {
          crawlTargets.push({
            url: lpUrl,
            campaignName: camp.creative_campaign_name || 'Unknown',
            domain,
          });
        }
      }
    }

    // Crawl in parallel (max 10 to avoid rate limits)
    const targets = crawlTargets.slice(0, 10);
    console.log(`[firecrawl] Crawling ${targets.length} landing pages`);

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
        } as LandingPageInsight;
      })
    );

    const landingPages: LandingPageInsight[] = results
      .filter((r): r is PromiseFulfilledResult<LandingPageInsight> => r.status === 'fulfilled')
      .map(r => r.value);

    console.log(`[firecrawl] ${landingPages.length}/${targets.length} pages crawled successfully`);

    // Write to report_data — landing page shields transform to content
    await mergeReportData(supabase, sessionId, {
      landingPages,
    });

    // Check if all Phase 3 data is present → trigger synthesize
    if (await isPhase3DataComplete(supabase, sessionId)) {
      await insertTasks(supabase, sessionId, [{
        taskType: 'ccr_synthesize',
        payload: { sessionId, jobId, brandDomain, userId },
      }]);
    }

  } catch (err) {
    console.error('[firecrawl] Error:', err);
    await markError(supabase, sessionId, jobId, err as Error);
  }
};

export const config: Config = { background: true };
