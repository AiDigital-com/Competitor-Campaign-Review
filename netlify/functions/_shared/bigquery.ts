/**
 * BigQuery / AdClarity helper.
 *
 * Two modes:
 * 1. Query mode (requires bigquery.jobUser) — runs SQL against the raw table.
 * 2. Training mode (Data Viewer only) — reads pre-aggregated summary tables
 *    via getRows() with client-side domain filtering. Slower but works without
 *    query execution permission.
 *
 * Tries query mode first, falls back to training mode automatically.
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
  const dataset = process.env.ADCLARITY_DATASET || 'adclarity_competitor_analysis';
  const table = process.env.ADCLARITY_TABLE_NAME || 'adclarity_aws_monthly_test_2026';
  return `\`${project}.${dataset}.${table}\``;
}

/**
 * Fetch AdClarity campaign data for a set of domains.
 * Tries SQL query first; falls back to summary-table scan if permissions block.
 */
export async function getAdClarityData(domains: string[]): Promise<CampaignData[]> {
  try {
    return await queryMode(domains);
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('bigquery.jobs.create') || msg.includes('Access Denied')) {
      console.log('[AdClarity] Query mode blocked — falling back to training mode');
      return trainingMode(domains);
    }
    throw err;
  }
}

// ── Query mode (full SQL — needs bigquery.jobUser) ──────────────────────────

async function queryMode(domains: string[]): Promise<CampaignData[]> {
  const bq = createClient();

  // COST SAFETY: Always filter by date to limit scanned data.
  const query = `
    WITH deduped AS (
      SELECT
        LOWER(advertiser_domain) AS domain,
        LOWER(publisher_domain)  AS publisher,
        channel_name             AS channel,
        CAST(creative_id AS STRING) AS creative_id,
        creative_url_supplier    AS creative_url,
        creative_mime_type       AS creative_mime_type,
        creative_first_seen_date AS creative_first_seen,
        MAX(impressions)         AS impressions,
        MAX(spend)               AS spend
      FROM ${tableRef()}
      WHERE LOWER(advertiser_domain) IN UNNEST(@domains)
        AND month >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH)
      GROUP BY 1, 2, 3, 4, 5, 6, 7
    )
    SELECT
      domain, channel, publisher,
      creative_id, creative_url, creative_mime_type, creative_first_seen,
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

  return buildCampaignData(rows);
}

// ── Training mode (getRows scan — Data Viewer only) ─────────────────────────

async function trainingMode(domains: string[]): Promise<CampaignData[]> {
  const bq = createClient();
  const ds = bq.dataset(process.env.ADCLARITY_DATASET || 'adclarity_competitor_analysis');
  const domainSet = new Set(domains.map(d => d.toLowerCase()));

  // Scan summary + publisher + creative tables in parallel
  const [summaryHits, publisherHits, creativeHits] = await Promise.all([
    scanTable(ds, 'adv_summary', domainSet, 1),
    scanTable(ds, 'adv_publisher_channel_method', domainSet, 15),
    scanTable(ds, 'adv_creative', domainSet, 10),
  ]);

  return Array.from(domainSet).map(domain => {
    const summary = summaryHits.get(domain)?.[0];
    const publishers = publisherHits.get(domain) || [];
    const creatives = creativeHits.get(domain) || [];

    const imp = Number(summary?.impressions) || 0;
    const spend = Number(summary?.spend) || 0;

    // Build channel breakdown from summary columns
    const channels: { name: string; impressions: number; spend: number }[] = [];
    if (summary) {
      const total = imp || 1;
      const displayImp = Number(summary.display_impressions) || 0;
      const videoImp = Number(summary.video_impressions) || 0;
      const socialImp = Number(summary.social_impressions) || 0;
      const ctvImp = Number(summary.ctv_impressions) || 0;
      if (displayImp) channels.push({ name: 'Display', impressions: displayImp, spend: Math.round(spend * displayImp / total) });
      if (videoImp) channels.push({ name: 'Video', impressions: videoImp, spend: Math.round(spend * videoImp / total) });
      if (socialImp) channels.push({ name: 'Social', impressions: socialImp, spend: Math.round(spend * socialImp / total) });
      if (ctvImp) channels.push({ name: 'CTV', impressions: ctvImp, spend: Math.round(spend * ctvImp / total) });
    }
    channels.sort((a, b) => b.impressions - a.impressions);

    return {
      domain,
      totalImpressions: imp,
      totalSpend: spend,
      channels,
      publishers: publishers
        .map((r: any) => ({
          domain: r.publisher_group || 'Unknown',
          impressions: Number(r.impressions) || 0,
          spend: Number(r.spend) || 0,
        }))
        .sort((a: any, b: any) => b.impressions - a.impressions)
        .slice(0, 10),
      creatives: creatives
        .map((r: any) => ({
          id: String(r.creative_id || r.creative_rank || ''),
          url: r.creative_url_supplier || '',
          mimeType: '',
          channelName: '',
          firstSeen: r.creative_first_seen ? String(r.creative_first_seen) : '',
        }))
        .slice(0, 20),
    };
  }).filter(d => d.totalImpressions > 0);
}

/** Paginate through a table, collecting rows matching target domains. */
async function scanTable(
  ds: any, tableName: string, targets: Set<string>, maxPerDomain: number,
): Promise<Map<string, any[]>> {
  const table = ds.table(tableName);
  const found = new Map<string, any[]>();
  let token: string | undefined;
  let allFound = false;

  while (!allFound) {
    const opts: any = { maxResults: 10000, autoPaginate: false };
    if (token) opts.pageToken = token;
    const [rows, nextQuery] = await table.getRows(opts);

    for (const r of rows) {
      const d = (r.advertiser_domain || '').toLowerCase();
      if (!targets.has(d)) continue;
      if (!found.has(d)) found.set(d, []);
      const arr = found.get(d)!;
      if (arr.length < maxPerDomain) arr.push(r);
    }

    token = nextQuery?.pageToken;
    if (!token) break;

    // Early exit if we found enough data for all domains
    if (found.size >= targets.size) {
      allFound = [...targets].every(d => (found.get(d)?.length || 0) >= maxPerDomain);
    }
  }

  return found;
}

// ── Shared: build CampaignData from query rows ──────────────────────────────

function buildCampaignData(rows: any[]): CampaignData[] {
  const byDomain = new Map<string, any[]>();
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

      const existingCh = channelMap.get(ch) ?? { impressions: 0, spend: 0 };
      channelMap.set(ch, { impressions: existingCh.impressions + imp, spend: existingCh.spend + spd });

      const existingPub = publisherMap.get(pub) ?? { impressions: 0, spend: 0 };
      publisherMap.set(pub, { impressions: existingPub.impressions + imp, spend: existingPub.spend + spd });

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
