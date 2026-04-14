/**
 * DataForSeo helper — competitor domain discovery.
 *
 * Uses the Google competitors_domain/live endpoint to find domains
 * competing on the same keywords as the target domain.
 * US market only (location_code: 2840).
 */

const BASE_URL = 'https://api.dataforseo.com';
const US_LOCATION_CODE = 2840;

/**
 * Discover competitor domains for a given domain using DataForSeo.
 * Returns up to 15 competitor domains sorted by competition score.
 */
export async function getCompetitorDomains(domain: string): Promise<string[]> {
  const auth = process.env.DATAFORSEO_AUTH;
  if (!auth) throw new Error('DATAFORSEO_AUTH not configured');

  const res = await fetch(`${BASE_URL}/v3/dataforseo_labs/google/competitors_domain/live`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      {
        target: domain,
        language_code: 'en',
        location_code: US_LOCATION_CODE,
        limit: 15,
        filters: [['intersections', '>=', 5]],
      },
    ]),
  });

  if (!res.ok) {
    throw new Error(`DataForSeo API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const task = json?.tasks?.[0];

  if (task?.status_code !== 20000) {
    // Non-fatal: return empty list so pipeline can continue without search data
    console.warn('DataForSeo task error:', task?.status_message);
    return [];
  }

  const items: Array<{ domain: string; competitor_metrics?: { organic?: { pos_1?: number } } }> =
    task?.result?.[0]?.items ?? [];

  return items
    .map(item => item.domain)
    .filter(Boolean)
    .slice(0, 15);
}
