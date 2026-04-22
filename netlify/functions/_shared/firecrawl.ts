/**
 * Firecrawl helper — scrape and screenshot landing pages.
 *
 * Used to:
 * 1. Verify that a competitor domain is in the same industry as the brand.
 * 2. Capture a screenshot of the homepage for the side-by-side report display.
 */

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1';

export interface ScrapeResult {
  markdown: string;
  screenshotUrl: string | null;
  title: string | null;
  description: string | null;
}

/**
 * Scrape a URL and return markdown content + screenshot.
 * Returns null on failure (treated as non-fatal — report still renders without screenshot).
 *
 * Commercial landing pages are JS-heavy; default Firecrawl settings returned
 * empty screenshots for ~half the targets. Two-pass: a short attempt first,
 * then a longer retry if the screenshot came back empty or the call failed.
 */
export async function scrapeUrl(url: string): Promise<ScrapeResult | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.warn('FIRECRAWL_API_KEY not configured — skipping scrape');
    return null;
  }

  const target = url.startsWith('http') ? url : `https://${url}`;

  async function attempt(waitMs: number, timeoutMs: number): Promise<ScrapeResult | null> {
    try {
      const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: target,
          formats: ['markdown', 'screenshot'],
          waitFor: waitMs,
          timeout: timeoutMs,
          onlyMainContent: false,
        }),
      });

      if (!res.ok) {
        console.warn(`Firecrawl scrape failed for ${url}: ${res.status}`);
        return null;
      }

      const json = await res.json();
      if (!json.success) {
        console.warn(`Firecrawl returned !success for ${url}:`, json.error);
        return null;
      }

      const data = json.data ?? {};
      return {
        markdown: (data.markdown as string) || '',
        screenshotUrl: (data.screenshot as string) || null,
        title: (data.metadata?.title as string) || null,
        description: (data.metadata?.description as string) || null,
      };
    } catch (err) {
      console.warn(`Firecrawl exception for ${url}:`, err);
      return null;
    }
  }

  let result = await attempt(2500, 30000);
  if (!result || !result.screenshotUrl) {
    const retry = await attempt(5000, 45000);
    if (retry && retry.screenshotUrl) result = retry;
    else if (!result && retry) result = retry;
  }
  return result;
}
