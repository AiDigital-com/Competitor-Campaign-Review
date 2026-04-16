/**
 * BQ extraction TEST — runs COUNT(*) queries only, no writes.
 * Reports estimated row counts for each table.
 * Also supports single-domain extraction to verify pipeline.
 *
 * Trigger: POST /.netlify/functions/extract-bq-test
 * Body: { "mode": "count" } — count rows only (~light BQ scan)
 *        { "mode": "sample", "domain": "coca-cola.com" } — extract 1 domain into Supabase
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

const DATE_FILTER = `month >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH) AND country = 'United States'`;

function serializeDates(row: any): any {
  const out: any = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v && typeof v === 'object' && (v as any).value ? (v as any).value : v;
  }
  return out;
}

async function batchInsert(sb: any, table: string, rows: any[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await sb.from(table).insert(batch);
    if (error) {
      console.error(`[test] Insert error on ${table} batch ${i}:`, error.message);
    } else {
      inserted += batch.length;
    }
  }
  return inserted;
}

export default async (req: Request) => {
  if (!process.env.GCP_PID || !process.env.GCP_SA) {
    return Response.json({ error: 'GCP_PID or GCP_SA not set' }, { status: 500 });
  }

  const body = await req.json().catch(() => ({ mode: 'count' }));
  const mode = body.mode || 'count';
  const bq = await getBQ();
  const table = rawTable();

  if (mode === 'count') {
    console.log('[test] Running count queries...');
    const counts: Record<string, number> = {};

    const queries: [string, string][] = [
      ['ccr_adv_summary', `SELECT COUNT(*) as cnt FROM (SELECT LOWER(advertiser_domain) FROM ${table} WHERE ${DATE_FILTER} GROUP BY 1)`],
      ['ccr_campaign_channel_detail', `SELECT COUNT(*) as cnt FROM (SELECT LOWER(advertiser_domain), creative_campaign_name, channel_name, advertiser_master_category, advertiser_second_category, transaction_method FROM ${table} WHERE ${DATE_FILTER} GROUP BY 1,2,3,4,5,6)`],
      ['ccr_creative_detail', `SELECT COUNT(*) as cnt FROM (SELECT LOWER(advertiser_domain), CAST(creative_id AS STRING), creative_campaign_name, channel_name, creative_url_supplier, creative_landingpage_url, creative_mime_type, creative_size, creative_video_duration FROM ${table} WHERE ${DATE_FILTER} GROUP BY 1,2,3,4,5,6,7,8,9)`],
      ['ccr_publisher_channel_method', `SELECT COUNT(*) as cnt FROM (SELECT LOWER(advertiser_domain), publisher_domain, transaction_method FROM ${table} WHERE ${DATE_FILTER} GROUP BY 1,2,3)`],
      ['ccr_expenditure_trend', `SELECT COUNT(*) as cnt FROM (SELECT LOWER(advertiser_domain), month FROM ${table} WHERE ${DATE_FILTER} GROUP BY 1,2)`],
    ];

    for (const [name, query] of queries) {
      console.log(`[test] Counting ${name}...`);
      const [rows] = await bq.query({ query });
      counts[name] = Number(rows[0]?.cnt || 0);
      console.log(`[test] ${name}: ${counts[name]} rows`);
    }

    const [rawCount] = await bq.query({ query: `SELECT COUNT(*) as cnt FROM ${table} WHERE ${DATE_FILTER}` });
    const [domainCount] = await bq.query({ query: `SELECT COUNT(DISTINCT LOWER(advertiser_domain)) as cnt FROM ${table} WHERE ${DATE_FILTER}` });

    const result = {
      mode: 'count',
      rawRows: Number(rawCount[0]?.cnt || 0),
      distinctDomains: Number(domainCount[0]?.cnt || 0),
      aggregatedCounts: counts,
      totalAggregatedRows: Object.values(counts).reduce((s, n) => s + n, 0),
    };

    console.log('[test] Results:', JSON.stringify(result, null, 2));
    return Response.json(result);
  }

  if (mode === 'sample') {
    const domain = (body.domain || 'coca-cola.com').toLowerCase();
    const domainFilter = `AND LOWER(advertiser_domain) = '${domain}'`;
    console.log(`[test] Sample extraction for: ${domain}`);
    const sb = getSupabase();
    const results: Record<string, number> = {};

    // 1. Summary (GROUP BY 1 = domain)
    const [s] = await bq.query({ query: `SELECT LOWER(advertiser_domain) as advertiser_domain, 'United States' as country, SUM(impressions) as impressions, SUM(spend) as spend, COUNT(DISTINCT publisher_domain) as distinct_publishers, COUNT(DISTINCT creative_id) as distinct_creatives, SUM(CASE WHEN channel_name LIKE '%Display%' THEN impressions ELSE 0 END) as display_impressions, SUM(CASE WHEN channel_name LIKE '%Video%' THEN impressions ELSE 0 END) as video_impressions, SUM(CASE WHEN channel_name LIKE '%Social%' THEN impressions ELSE 0 END) as social_impressions, SUM(CASE WHEN channel_name LIKE '%CTV%' THEN impressions ELSE 0 END) as ctv_impressions FROM ${table} WHERE ${DATE_FILTER} ${domainFilter} GROUP BY 1` });
    await sb.from('ccr_adv_summary').delete().eq('advertiser_domain', domain);
    results.ccr_adv_summary = await batchInsert(sb, 'ccr_adv_summary', s);

    // 2. Campaign detail (GROUP BY 1,3,4,5,6,7 — skip 2=country literal)
    const [c] = await bq.query({ query: `SELECT LOWER(advertiser_domain) as advertiser_domain, 'United States' as country, creative_campaign_name, channel_name, advertiser_master_category, advertiser_second_category, transaction_method, ANY_VALUE(creative_landingpage_url) as landing_page_url, SUM(impressions) as impressions, SUM(spend) as spend, AVG(ctr) as ctr, COUNT(DISTINCT creative_id) as creative_count, COUNT(DISTINCT publisher_domain) as publisher_count, MIN(creative_first_seen_date) as first_seen, MAX(creative_last_seen_date) as last_seen FROM ${table} WHERE ${DATE_FILTER} ${domainFilter} GROUP BY 1,3,4,5,6,7 ORDER BY impressions DESC` });
    await sb.from('ccr_campaign_channel_detail').delete().eq('advertiser_domain', domain);
    results.ccr_campaign_channel_detail = await batchInsert(sb, 'ccr_campaign_channel_detail', c.map(serializeDates));

    // 3. Creative detail (GROUP BY 1,3,4,5,6,7,8,9,10 — skip 2=country literal)
    const [cr] = await bq.query({ query: `SELECT LOWER(advertiser_domain) as advertiser_domain, 'United States' as country, CAST(creative_id AS STRING) as creative_id, creative_campaign_name, channel_name, creative_url_supplier, creative_landingpage_url, creative_mime_type, creative_size, creative_video_duration, MIN(creative_first_seen_date) as first_seen, MAX(creative_last_seen_date) as last_seen, SUM(impressions) as impressions, SUM(spend) as spend, AVG(ctr) as ctr FROM ${table} WHERE ${DATE_FILTER} ${domainFilter} GROUP BY 1,3,4,5,6,7,8,9,10 ORDER BY impressions DESC` });
    await sb.from('ccr_creative_detail').delete().eq('advertiser_domain', domain);
    results.ccr_creative_detail = await batchInsert(sb, 'ccr_creative_detail', cr.map(serializeDates));

    // 4. Publisher (GROUP BY 1,3,4 — skip 2=country literal)
    const [p] = await bq.query({ query: `SELECT LOWER(advertiser_domain) as advertiser_domain, 'United States' as country, publisher_domain as publisher_group, transaction_method, SUM(impressions) as impressions, SUM(spend) as spend, SUM(CASE WHEN channel_name LIKE '%Display%' THEN impressions ELSE 0 END) as display_impressions, SUM(CASE WHEN channel_name LIKE '%Video%' THEN impressions ELSE 0 END) as video_impressions, SUM(CASE WHEN channel_name LIKE '%Social%' THEN impressions ELSE 0 END) as social_impressions, SUM(CASE WHEN channel_name LIKE '%CTV%' THEN impressions ELSE 0 END) as ctv_impressions FROM ${table} WHERE ${DATE_FILTER} ${domainFilter} GROUP BY 1,3,4 ORDER BY impressions DESC` });
    await sb.from('ccr_publisher_channel_method').delete().eq('advertiser_domain', domain);
    results.ccr_publisher_channel_method = await batchInsert(sb, 'ccr_publisher_channel_method', p);

    // 5. Trend (GROUP BY 1,3 — skip 2=country literal)
    const [t2] = await bq.query({ query: `SELECT LOWER(advertiser_domain) as advertiser_domain, 'United States' as country, month, SUM(impressions) as impressions, SUM(spend) as spend FROM ${table} WHERE ${DATE_FILTER} ${domainFilter} GROUP BY 1,3 ORDER BY month ASC` });
    await sb.from('ccr_expenditure_trend').delete().eq('advertiser_domain', domain);
    results.ccr_expenditure_trend = await batchInsert(sb, 'ccr_expenditure_trend', t2.map(serializeDates));

    const result = { mode: 'sample', domain, rows: results, total: Object.values(results).reduce((s, n) => s + n, 0) };
    console.log('[test] Sample results:', JSON.stringify(result, null, 2));
    return Response.json(result);
  }

  return Response.json({ error: 'Unknown mode. Use "count" or "sample".' }, { status: 400 });
};

export const config: Config = { background: true };
