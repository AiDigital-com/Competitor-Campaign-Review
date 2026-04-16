/**
 * BQ → Supabase extraction script.
 * Runs 5 aggregation queries against the raw AdClarity BQ table,
 * inserts pre-aggregated results into Supabase training tables.
 *
 * One-time run (~206GB BQ scan, ~$1). After this, useBQ() stays off.
 * Trigger: POST /.netlify/functions/extract-bq-data (background, 15min timeout)
 *
 * Safety: truncates target tables before insert to avoid duplicates.
 */
import type { Config } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const BATCH_SIZE = 500;

function getSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function getBQ() {
  const { BigQuery } = await import('@google-cloud/bigquery');
  const sb = getSupabase();
  const { data } = await sb.from('ccr_secrets').select('value').eq('key', 'GCP_PRIVATE_KEY').single();
  const privateKey = (data?.value || '').replace(/\\n/g, '\n');
  return new BigQuery({
    projectId: process.env.GCP_PID!,
    credentials: { client_email: process.env.GCP_SA!, private_key: privateKey },
  });
}

function rawTable(): string {
  const p = process.env.GCP_PID!;
  const ds = process.env.ADCLARITY_DATASET || 'adclarity_competitor_analysis';
  const t = process.env.ADCLARITY_TABLE_NAME || 'adclarity_aws_monthly_test_2026';
  return `\`${p}.${ds}.${t}\``;
}

/** 1-month window: most recent full month. DATE_TRUNC gives first-of-month so we capture the whole month. */
const DATE_FILTER = `month >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH) AND country = 'United States'`;

async function batchInsert(sb: any, table: string, rows: any[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await sb.from(table).insert(batch);
    if (error) {
      console.error(`[extract] Insert error on ${table} batch ${i}:`, error.message);
    } else {
      inserted += batch.length;
    }
  }
  return inserted;
}

function serializeDates(row: any): any {
  const out: any = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v && typeof v === 'object' && (v as any).value ? (v as any).value : v;
  }
  return out;
}

/**
 * POST body: { "table": "summary" | "campaigns" | "creatives" | "publishers" | "trends" }
 * Runs ONE table extraction per call. Call 5 times for full extraction.
 * This way each table is independent — retry individually if one fails.
 */
export default async (req: Request) => {
  const startTime = Date.now();
  const sb = getSupabase();

  if (!process.env.GCP_PID || !process.env.GCP_SA) {
    console.error('[extract] GCP_PID or GCP_SA not set');
    return;
  }

  const body = await req.json().catch(() => ({}));
  const target = (body.table || '').toLowerCase();
  const validTargets = ['summary', 'campaigns', 'creatives', 'publishers', 'trends'];
  if (!validTargets.includes(target)) {
    console.error(`[extract] Invalid table: "${target}". Use one of: ${validTargets.join(', ')}`);
    return;
  }

  const bq = await getBQ();
  const table = rawTable();
  const results: Record<string, number> = {};

  console.log(`[extract] Starting BQ extraction: table=${target} from ${table}`);
  console.log(`[extract] Date filter: ${DATE_FILTER}`);

  // ── 1. ADV SUMMARY ───────────────────────────────────────────────────────
  if (target === 'summary') {
  console.log('[extract] ccr_adv_summary...');
  await sb.from('ccr_adv_summary').delete().neq('advertiser_domain', '');

  const [summaryRows] = await bq.query({
    query: `
      SELECT
        LOWER(advertiser_domain) as advertiser_domain,
        'United States' as country,
        SUM(impressions) as impressions,
        SUM(spend) as spend,
        COUNT(DISTINCT publisher_domain) as distinct_publishers,
        COUNT(DISTINCT creative_id) as distinct_creatives,
        SUM(CASE WHEN channel_name LIKE '%Display%' THEN impressions ELSE 0 END) as display_impressions,
        SUM(CASE WHEN channel_name LIKE '%Video%' THEN impressions ELSE 0 END) as video_impressions,
        SUM(CASE WHEN channel_name LIKE '%Social%' THEN impressions ELSE 0 END) as social_impressions,
        SUM(CASE WHEN channel_name LIKE '%CTV%' THEN impressions ELSE 0 END) as ctv_impressions
      FROM ${table}
      WHERE ${DATE_FILTER}
      GROUP BY 1
      ORDER BY impressions DESC`,
  });
  results.ccr_adv_summary = await batchInsert(sb, 'ccr_adv_summary', summaryRows);
  console.log(`[extract] ccr_adv_summary: ${results.ccr_adv_summary} rows`);
  }

  // ── 2. CAMPAIGN CHANNEL DETAIL ────────────────────────────────────────────
  if (target === 'campaigns') {
  console.log('[extract] ccr_campaign_channel_detail...');
  await sb.from('ccr_campaign_channel_detail').delete().neq('advertiser_domain', '');

  const [campaignRows] = await bq.query({
    query: `
      SELECT
        LOWER(advertiser_domain) as advertiser_domain,
        'United States' as country,
        creative_campaign_name, channel_name,
        advertiser_master_category, advertiser_second_category,
        transaction_method,
        ANY_VALUE(creative_landingpage_url) as landing_page_url,
        SUM(impressions) as impressions, SUM(spend) as spend,
        AVG(ctr) as ctr,
        COUNT(DISTINCT creative_id) as creative_count,
        COUNT(DISTINCT publisher_domain) as publisher_count,
        MIN(creative_first_seen_date) as first_seen,
        MAX(creative_last_seen_date) as last_seen
      FROM ${table}
      WHERE ${DATE_FILTER}
      GROUP BY 1,3,4,5,6,7
      ORDER BY impressions DESC`,
  });
  results.ccr_campaign_channel_detail = await batchInsert(
    sb, 'ccr_campaign_channel_detail',
    campaignRows.map(serializeDates),
  );
  console.log(`[extract] ccr_campaign_channel_detail: ${results.ccr_campaign_channel_detail} rows`);
  }

  // ── 3. CREATIVE DETAIL ────────────────────────────────────────────────────
  if (target === 'creatives') {
  console.log('[extract] ccr_creative_detail...');
  await sb.from('ccr_creative_detail').delete().neq('advertiser_domain', '');

  const [creativeRows] = await bq.query({
    query: `
      SELECT
        LOWER(advertiser_domain) as advertiser_domain,
        'United States' as country,
        CAST(creative_id AS STRING) as creative_id,
        creative_campaign_name, channel_name,
        creative_url_supplier, creative_landingpage_url,
        creative_mime_type, creative_size, creative_video_duration,
        MIN(creative_first_seen_date) as first_seen,
        MAX(creative_last_seen_date) as last_seen,
        SUM(impressions) as impressions, SUM(spend) as spend,
        AVG(ctr) as ctr
      FROM ${table}
      WHERE ${DATE_FILTER}
      GROUP BY 1,3,4,5,6,7,8,9,10
      ORDER BY impressions DESC`,
  });
  results.ccr_creative_detail = await batchInsert(
    sb, 'ccr_creative_detail',
    creativeRows.map(serializeDates),
  );
  console.log(`[extract] ccr_creative_detail: ${results.ccr_creative_detail} rows`);
  }

  // ── 4. PUBLISHER CHANNEL METHOD ───────────────────────────────────────────
  if (target === 'publishers') {
  console.log('[extract] ccr_publisher_channel_method...');
  await sb.from('ccr_publisher_channel_method').delete().neq('advertiser_domain', '');

  const [publisherRows] = await bq.query({
    query: `
      SELECT
        LOWER(advertiser_domain) as advertiser_domain,
        'United States' as country,
        publisher_domain as publisher_group,
        transaction_method,
        SUM(impressions) as impressions, SUM(spend) as spend,
        SUM(CASE WHEN channel_name LIKE '%Display%' THEN impressions ELSE 0 END) as display_impressions,
        SUM(CASE WHEN channel_name LIKE '%Video%' THEN impressions ELSE 0 END) as video_impressions,
        SUM(CASE WHEN channel_name LIKE '%Social%' THEN impressions ELSE 0 END) as social_impressions,
        SUM(CASE WHEN channel_name LIKE '%CTV%' THEN impressions ELSE 0 END) as ctv_impressions
      FROM ${table}
      WHERE ${DATE_FILTER}
      GROUP BY 1,3,4
      ORDER BY impressions DESC`,
  });
  results.ccr_publisher_channel_method = await batchInsert(
    sb, 'ccr_publisher_channel_method',
    publisherRows,
  );
  console.log(`[extract] ccr_publisher_channel_method: ${results.ccr_publisher_channel_method} rows`);
  }

  // ── 5. EXPENDITURE TREND ──────────────────────────────────────────────────
  if (target === 'trends') {
  console.log('[extract] ccr_expenditure_trend...');
  await sb.from('ccr_expenditure_trend').delete().neq('advertiser_domain', '');

  const [trendRows] = await bq.query({
    query: `
      SELECT
        LOWER(advertiser_domain) as advertiser_domain,
        'United States' as country,
        month, SUM(impressions) as impressions, SUM(spend) as spend
      FROM ${table}
      WHERE ${DATE_FILTER}
      GROUP BY 1,3
      ORDER BY month ASC, impressions DESC`,
  });
  results.ccr_expenditure_trend = await batchInsert(
    sb, 'ccr_expenditure_trend',
    trendRows.map(serializeDates),
  );
  console.log(`[extract] ccr_expenditure_trend: ${results.ccr_expenditure_trend} rows`);
  }

  // ── ANALYZE: warm query planner stats after bulk insert ─────────────────
  // PostgREST count queries force PostgreSQL to update stats on these tables
  console.log('[extract] Warming query planner stats...');
  for (const t of ['ccr_adv_summary', 'ccr_campaign_channel_detail', 'ccr_creative_detail', 'ccr_publisher_channel_method', 'ccr_expenditure_trend']) {
    await sb.from(t).select('advertiser_domain', { count: 'exact', head: true });
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  const duration = Math.round((Date.now() - startTime) / 1000);
  const totalRows = Object.values(results).reduce((s, n) => s + n, 0);
  console.log(`[extract] COMPLETE: ${totalRows} total rows in ${duration}s`);
  console.log('[extract] Results:', JSON.stringify(results));

  try {
    const { logTokenUsage, detectSource } = await import('@AiDigital-com/design-system/logger');
    logTokenUsage(sb as any, {
      userId: 'system', orgId: null,
      app: 'competitor-campaign-review:bq-extract',
      source: detectSource('system'),
      aiProvider: 'bigquery', aiModel: 'full-extraction',
      inputTokens: 0, outputTokens: totalRows, totalTokens: totalRows,
    }).catch(() => {});
  } catch {}
};

export const config: Config = { background: true };
