/**
 * BigQuery / AdClarity helper.
 *
 * Queries the AdClarity dataset for campaign intelligence.
 * Dedup rule: MAX(IMPRESSIONS) and MAX(SPEND) at
 * (ADVERTISER_DOMAIN, occurence_collectiondate, PUBLISHER_DOMAIN, CHANNEL_NAME) grain.
 */
import { BigQuery } from '@google-cloud/bigquery';
import type { CampaignData } from '../../../src/lib/types.js';

function createClient(): BigQuery {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS!);
  return new BigQuery({
    projectId: process.env.GCP_PROJECT_ID!,
    credentials,
  });
}

function tableRef(): string {
  const project = process.env.GCP_PROJECT_ID!;
  const dataset = process.env.ADCLARITY_DATASET || 'adclarity';
  const table = process.env.ADCLARITY_TABLE_NAME || 'adclarity_sample_data';
  return `\`${project}.${dataset}.${table}\``;
}

/**
 * Fetch AdClarity campaign data for a set of domains.
 * Returns one CampaignData entry per domain found in the dataset.
 */
export async function getAdClarityData(domains: string[]): Promise<CampaignData[]> {
  const bq = createClient();

  const query = `
    WITH deduped AS (
      SELECT
        LOWER(ADVERTISER_DOMAIN) AS domain,
        LOWER(PUBLISHER_DOMAIN)  AS publisher,
        CHANNEL_NAME             AS channel,
        CREATIVE_ID              AS creative_id,
        CREATIVE_URL_SUPPLIER    AS creative_url,
        CREATIVE_MIME_TYPE       AS creative_mime_type,
        CREATIVE_FIRST_SEEN_DATE AS creative_first_seen,
        MAX(IMPRESSIONS)         AS impressions,
        MAX(SPEND)               AS spend
      FROM ${tableRef()}
      WHERE LOWER(ADVERTISER_DOMAIN) IN UNNEST(@domains)
      GROUP BY 1, 2, 3, 4, 5, 6, 7
    )
    SELECT
      domain,
      channel,
      publisher,
      creative_id,
      creative_url,
      creative_mime_type,
      creative_first_seen,
      SUM(impressions) AS impressions,
      SUM(spend)       AS spend
    FROM deduped
    GROUP BY 1, 2, 3, 4, 5, 6, 7
    ORDER BY impressions DESC
  `;

  const [rows] = await bq.query({
    query,
    params: { domains: domains.map(d => d.toLowerCase()) },
    types: { domains: ['STRING'] },
  });

  const byDomain = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = (row.domain as string) ?? '';
    if (!byDomain.has(key)) byDomain.set(key, []);
    byDomain.get(key)!.push(row);
  }

  return Array.from(byDomain.entries()).map(([domain, domainRows]) => {
    const channelMap = new Map<string, { impressions: number; spend: number }>();
    const publisherMap = new Map<string, { impressions: number; spend: number }>();
    const creativeMap = new Map<string, { url: string; mimeType: string; channelName: string; firstSeen: string }>();

    let totalImpressions = 0;
    let totalSpend = 0;

    for (const row of domainRows) {
      const imp = Number(row.impressions) || 0;
      const spd = Number(row.spend) || 0;
      const ch = (row.channel as string) || 'Unknown';
      const pub = (row.publisher as string) || 'Unknown';

      // Channel roll-up
      const existingCh = channelMap.get(ch) ?? { impressions: 0, spend: 0 };
      channelMap.set(ch, { impressions: existingCh.impressions + imp, spend: existingCh.spend + spd });

      // Publisher roll-up (already deduped at channel level, roll up to publisher)
      const existingPub = publisherMap.get(pub) ?? { impressions: 0, spend: 0 };
      publisherMap.set(pub, { impressions: existingPub.impressions + imp, spend: existingPub.spend + spd });

      // Creatives — keep one record per creative_id
      if (row.creative_id && !creativeMap.has(row.creative_id as string)) {
        creativeMap.set(row.creative_id as string, {
          url: (row.creative_url as string) || '',
          mimeType: (row.creative_mime_type as string) || '',
          channelName: ch,
          firstSeen: (row.creative_first_seen as string) || '',
        });
      }

      totalImpressions += imp;
      totalSpend += spd;
    }

    return {
      domain,
      totalImpressions,
      totalSpend,
      channels: Array.from(channelMap.entries())
        .map(([name, d]) => ({ name, impressions: d.impressions, spend: d.spend }))
        .sort((a, b) => b.impressions - a.impressions),
      publishers: Array.from(publisherMap.entries())
        .map(([pub, d]) => ({ domain: pub, impressions: d.impressions, spend: d.spend }))
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 10),
      creatives: Array.from(creativeMap.entries())
        .map(([id, d]) => ({ id, url: d.url, mimeType: d.mimeType, channelName: d.channelName, firstSeen: d.firstSeen }))
        .slice(0, 20),
    };
  });
}
