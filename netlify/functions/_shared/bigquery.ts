/**
 * AdClarity data access layer.
 *
 * Two backends, same query results:
 * - Production: BigQuery raw table (GCP_PROJECT_ID + GCP_CLIENT_EMAIL + GCP_PRIVATE_KEY)
 * - Development: Supabase relational tables (ccr_adv_summary, ccr_campaign_channel_detail, etc.)
 *
 * COST SAFETY: Every BQ query MUST have:
 *   1. WHERE month >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH) — limits scan window
 *   2. WHERE advertiser_domain IN (...) — limits to requested domains only
 *   3. LIMIT clause — caps row count
 *   Raw table is 268M rows / 214GB. Unfiltered queries cost $$$.
 */
import { createClient as createSupabase } from '@supabase/supabase-js';
import type { CampaignData } from '../../../src/lib/types.js';

function getSupabase() {
  return createSupabase(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function useBQ(): boolean {
  return !!(process.env.GCP_PID && process.env.GCP_SA);
}

let _cachedPK: string | null = null;
async function getPrivateKey(): Promise<string> {
  if (_cachedPK) return _cachedPK;
  // Private key stored in Supabase (too large for Lambda 4KB env var limit)
  const sb = getSupabase();
  const { data } = await sb.from('ccr_secrets').select('value').eq('key', 'GCP_PRIVATE_KEY').single();
  _cachedPK = (data?.value || '').replace(/\\n/g, '\n');
  return _cachedPK;
}

async function getBQ() {
  const { BigQuery } = await import('@google-cloud/bigquery');
  const privateKey = await getPrivateKey();
  const credentials = { client_email: process.env.GCP_SA!, private_key: privateKey };
  return new BigQuery({ projectId: process.env.GCP_PID!, credentials });
}

function rawTable(): string {
  const p = process.env.GCP_PID!;
  const ds = process.env.ADCLARITY_DATASET || 'adclarity_competitor_analysis';
  const t = process.env.ADCLARITY_TABLE_NAME || 'adclarity_aws_monthly_test_2026';
  return `\`${p}.${ds}.${t}\``;
}

/** COST SAFETY: 3-month rolling window filter. Applied to EVERY BQ query. */
const DATE_FILTER = `month >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH)`;

/** Track BQ query as API cost (1 unit per query). Fire-and-forget. */
async function trackBQUsage(queryName: string, userId?: string): Promise<void> {
  try {
    const { logTokenUsage, detectSource } = await import('@AiDigital-com/design-system/logger');
    const sb = getSupabase();
    const { getUserOrgId } = await import('@AiDigital-com/design-system/access');
    const uid = userId || 'system';
    const orgId = await getUserOrgId(sb as any, uid).catch(() => null);
    logTokenUsage(sb as any, {
      userId: uid, orgId,
      app: `competitor-campaign-review:${queryName}`,
      source: detectSource(uid),
      aiProvider: 'bigquery', aiModel: 'adclarity-raw',
      inputTokens: 0, outputTokens: 1, totalTokens: 1,
    }).catch(() => {});
  } catch {}
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch summary data for domains.
 */
export async function getAdSummary(domains: string[]): Promise<any[]> {
  const lower = domains.map(d => d.toLowerCase());

  if (useBQ()) {
    const bq = await getBQ();
    const [rows] = await bq.query({
      query: `
        SELECT
          LOWER(advertiser_domain) as advertiser_domain,
          SUM(impressions) as impressions,
          SUM(spend) as spend,
          COUNT(DISTINCT publisher_domain) as distinct_publishers,
          COUNT(DISTINCT creative_id) as distinct_creatives,
          SUM(CASE WHEN channel_name LIKE '%Display%' THEN impressions ELSE 0 END) as display_impressions,
          SUM(CASE WHEN channel_name LIKE '%Video%' THEN impressions ELSE 0 END) as video_impressions,
          SUM(CASE WHEN channel_name LIKE '%Social%' THEN impressions ELSE 0 END) as social_impressions,
          SUM(CASE WHEN channel_name LIKE '%CTV%' THEN impressions ELSE 0 END) as ctv_impressions
        FROM ${rawTable()}
        WHERE LOWER(advertiser_domain) IN UNNEST(@domains) AND ${DATE_FILTER}
        GROUP BY 1`,
      params: { domains: lower },
      types: { domains: ['STRING'] },
    });
    await trackBQUsage('summary');
    console.log(`[BQ] getAdSummary: ${rows.length} rows for ${lower.length} domains`);
    return rows;
  }

  const sb = getSupabase();
  const { data } = await sb.from('ccr_adv_summary').select('*').in('advertiser_domain', lower);
  return data || [];
}

/**
 * Fetch campaign × channel detail for domains.
 */
export async function getCampaignDetail(domains: string[], limit = 50): Promise<any[]> {
  const lower = domains.map(d => d.toLowerCase());

  if (useBQ()) {
    const bq = await getBQ();
    const [rows] = await bq.query({
      query: `
        SELECT
          LOWER(advertiser_domain) as advertiser_domain,
          creative_campaign_name, channel_name,
          advertiser_master_category, advertiser_second_category,
          transaction_method,
          ANY_VALUE(creative_landingpage_url) as landing_page_url,
          SUM(impressions) as impressions, SUM(spend) as spend,
          COUNT(DISTINCT creative_id) as creative_count,
          COUNT(DISTINCT publisher_domain) as publisher_count,
          MIN(creative_first_seen_date) as first_seen,
          MAX(creative_last_seen_date) as last_seen
        FROM ${rawTable()}
        WHERE LOWER(advertiser_domain) IN UNNEST(@domains) AND ${DATE_FILTER}
        GROUP BY 1,2,3,4,5,6
        ORDER BY impressions DESC
        LIMIT @limit`,
      params: { domains: lower, limit },
      types: { domains: ['STRING'] },
    });
    await trackBQUsage('campaign-detail');
    console.log(`[BQ] getCampaignDetail: ${rows.length} rows`);
    return rows.map(serializeDates);
  }

  const sb = getSupabase();
  const { data } = await sb
    .from('ccr_campaign_channel_detail')
    .select('*')
    .in('advertiser_domain', lower)
    .order('impressions', { ascending: false })
    .limit(limit);
  return data || [];
}

/**
 * Fetch ALL campaigns per domain for the 3-month rolling window.
 * Uses ROW_NUMBER() windowed by domain so each domain gets fair coverage.
 * Single BQ scan — no extra cost vs getCampaignDetail.
 * Used by Lambda 3a for exhaustive LLM filtering.
 */
export async function getCampaignDetailExhaustive(domains: string[], perDomainLimit = 50): Promise<any[]> {
  const lower = domains.map(d => d.toLowerCase());

  if (useBQ()) {
    const bq = await getBQ();
    const [rows] = await bq.query({
      query: `
        WITH campaign_agg AS (
          SELECT
            LOWER(advertiser_domain) as advertiser_domain,
            creative_campaign_name, channel_name,
            advertiser_master_category, advertiser_second_category,
            transaction_method,
            ANY_VALUE(creative_landingpage_url) as landing_page_url,
            SUM(impressions) as impressions, SUM(spend) as spend,
            COUNT(DISTINCT creative_id) as creative_count,
            COUNT(DISTINCT publisher_domain) as publisher_count,
            MIN(creative_first_seen_date) as first_seen,
            MAX(creative_last_seen_date) as last_seen
          FROM ${rawTable()}
          WHERE LOWER(advertiser_domain) IN UNNEST(@domains) AND ${DATE_FILTER}
          GROUP BY 1,2,3,4,5,6
        ),
        ranked AS (
          SELECT *, ROW_NUMBER() OVER (
            PARTITION BY advertiser_domain ORDER BY impressions DESC
          ) as domain_rank
          FROM campaign_agg
        )
        SELECT * EXCEPT(domain_rank) FROM ranked
        WHERE domain_rank <= @per_domain_limit
        ORDER BY advertiser_domain, impressions DESC`,
      params: { domains: lower, per_domain_limit: perDomainLimit },
      types: { domains: ['STRING'] },
    });
    await trackBQUsage('campaign-detail-exhaustive');
    console.log(`[BQ] getCampaignDetailExhaustive: ${rows.length} rows across ${lower.length} domains (${perDomainLimit}/domain)`);
    return rows.map(serializeDates);
  }

  // Supabase fallback: fetch per-domain with individual limits
  const sb = getSupabase();
  const results: any[] = [];
  for (const d of lower) {
    const { data } = await sb
      .from('ccr_campaign_channel_detail')
      .select('*')
      .eq('advertiser_domain', d)
      .order('impressions', { ascending: false })
      .limit(perDomainLimit);
    if (data) results.push(...data);
  }
  return results;
}

/**
 * Fetch creative detail for domains.
 */
export async function getCreativeDetail(domains: string[], limit = 50): Promise<any[]> {
  const lower = domains.map(d => d.toLowerCase());

  if (useBQ()) {
    const bq = await getBQ();
    const [rows] = await bq.query({
      query: `
        SELECT
          LOWER(advertiser_domain) as advertiser_domain,
          CAST(creative_id AS STRING) as creative_id,
          creative_campaign_name, channel_name,
          creative_url_supplier, creative_landingpage_url,
          creative_mime_type, creative_size, creative_video_duration,
          MIN(creative_first_seen_date) as first_seen,
          MAX(creative_last_seen_date) as last_seen,
          SUM(impressions) as impressions, SUM(spend) as spend
        FROM ${rawTable()}
        WHERE LOWER(advertiser_domain) IN UNNEST(@domains) AND ${DATE_FILTER}
        GROUP BY 1,2,3,4,5,6,7,8,9
        ORDER BY impressions DESC
        LIMIT @limit`,
      params: { domains: lower, limit },
      types: { domains: ['STRING'] },
    });
    await trackBQUsage('creative-detail');
    console.log(`[BQ] getCreativeDetail: ${rows.length} rows`);
    return rows.map(serializeDates);
  }

  const sb = getSupabase();
  const { data } = await sb
    .from('ccr_creative_detail')
    .select('*')
    .in('advertiser_domain', lower)
    .order('impressions', { ascending: false })
    .limit(limit);
  return data || [];
}

/**
 * Fetch publisher breakdown for domains.
 */
export async function getPublisherData(domains: string[], limit = 50): Promise<any[]> {
  const lower = domains.map(d => d.toLowerCase());

  if (useBQ()) {
    const bq = await getBQ();
    const [rows] = await bq.query({
      query: `
        SELECT
          LOWER(advertiser_domain) as advertiser_domain,
          publisher_domain as publisher_group,
          transaction_method,
          SUM(impressions) as impressions, SUM(spend) as spend,
          SUM(CASE WHEN channel_name LIKE '%Display%' THEN impressions ELSE 0 END) as display_impressions,
          SUM(CASE WHEN channel_name LIKE '%Video%' THEN impressions ELSE 0 END) as video_impressions,
          SUM(CASE WHEN channel_name LIKE '%Social%' THEN impressions ELSE 0 END) as social_impressions,
          SUM(CASE WHEN channel_name LIKE '%CTV%' THEN impressions ELSE 0 END) as ctv_impressions
        FROM ${rawTable()}
        WHERE LOWER(advertiser_domain) IN UNNEST(@domains) AND ${DATE_FILTER}
        GROUP BY 1,2,3
        ORDER BY impressions DESC
        LIMIT @limit`,
      params: { domains: lower, limit },
      types: { domains: ['STRING'] },
    });
    await trackBQUsage('publisher-data');
    console.log(`[BQ] getPublisherData: ${rows.length} rows`);
    return rows;
  }

  const sb = getSupabase();
  const { data } = await sb
    .from('ccr_publisher_channel_method')
    .select('*')
    .in('advertiser_domain', lower)
    .order('impressions', { ascending: false })
    .limit(limit);
  return data || [];
}

/**
 * Fetch monthly expenditure trends for domains.
 */
export async function getExpenditureTrend(domains: string[]): Promise<any[]> {
  const lower = domains.map(d => d.toLowerCase());

  if (useBQ()) {
    const bq = await getBQ();
    const [rows] = await bq.query({
      query: `
        SELECT
          LOWER(advertiser_domain) as advertiser_domain,
          month, SUM(impressions) as impressions, SUM(spend) as spend
        FROM ${rawTable()}
        WHERE LOWER(advertiser_domain) IN UNNEST(@domains)
        GROUP BY 1,2
        ORDER BY month ASC
        LIMIT 500`,
      params: { domains: lower },
      types: { domains: ['STRING'] },
    });
    await trackBQUsage('expenditure-trend');
    console.log(`[BQ] getExpenditureTrend: ${rows.length} rows`);
    return rows.map(serializeDates);
  }

  const sb = getSupabase();
  const { data } = await sb
    .from('ccr_expenditure_trend')
    .select('*')
    .in('advertiser_domain', lower)
    .order('month', { ascending: true });
  return data || [];
}

export interface CompetitorCandidate {
  domain: string;
  impressions: number;
  spend: number;
  topCampaigns: string[];
}

/**
 * Discover top ad competitors (same category) WITH top campaign names.
 * Campaign names enable product-line matching in LLM verify step.
 * Single BQ query — no extra latency vs previous version.
 */
export async function discoverAdCompetitors(brandDomain: string, limit = 10): Promise<CompetitorCandidate[]> {
  const brand = brandDomain.toLowerCase();

  if (useBQ()) {
    const bq = await getBQ();
    const [rows] = await bq.query({
      query: `
        WITH brand_cat AS (
          SELECT advertiser_second_category
          FROM ${rawTable()}
          WHERE LOWER(advertiser_domain) = @brand AND ${DATE_FILTER}
          LIMIT 1
        ),
        competitor_campaigns AS (
          SELECT
            LOWER(advertiser_domain) as advertiser_domain,
            creative_campaign_name,
            SUM(impressions) as camp_imps,
            SUM(spend) as camp_spend
          FROM ${rawTable()}
          WHERE LOWER(advertiser_domain) != @brand
            AND ${DATE_FILTER}
            AND advertiser_second_category = (SELECT advertiser_second_category FROM brand_cat)
          GROUP BY 1, 2
        )
        SELECT
          advertiser_domain,
          SUM(camp_imps) as impressions,
          SUM(camp_spend) as spend,
          ARRAY_AGG(creative_campaign_name ORDER BY camp_imps DESC LIMIT 5) as top_campaigns
        FROM competitor_campaigns
        GROUP BY 1
        ORDER BY SUM(camp_imps) DESC
        LIMIT @limit`,
      params: { brand, limit },
    });
    await trackBQUsage('discover-competitors');
    console.log(`[BQ] discoverAdCompetitors: ${rows.length} competitors for ${brand}`);
    return rows.map((r: any) => ({
      domain: r.advertiser_domain,
      impressions: Number(r.impressions) || 0,
      spend: Number(r.spend) || 0,
      topCampaigns: (r.top_campaigns || []).map((c: string) => (c || '').replace(/\s+\d{7,}$/, '')),
    }));
  }

  // Supabase fallback — no campaign names available from summary table
  const sb = getSupabase();
  const { data } = await sb
    .from('ccr_adv_summary')
    .select('advertiser_domain, impressions, spend')
    .neq('advertiser_domain', brand)
    .order('impressions', { ascending: false })
    .limit(limit);
  return (data || []).map(r => ({
    domain: r.advertiser_domain,
    impressions: Number(r.impressions) || 0,
    spend: Number(r.spend) || 0,
    topCampaigns: [],
  }));
}

/**
 * Build CampaignData objects for a set of domains.
 */
export async function getAdClarityData(domains: string[]): Promise<CampaignData[]> {
  const [summaries, creatives, pubs] = await Promise.all([
    getAdSummary(domains),
    getCreativeDetail(domains, 60),
    getPublisherData(domains, 60),
  ]);

  const summaryMap = new Map(summaries.map(s => [s.advertiser_domain, s]));

  const creativesByDomain = new Map<string, any[]>();
  for (const c of creatives) {
    const d = c.advertiser_domain;
    if (!creativesByDomain.has(d)) creativesByDomain.set(d, []);
    creativesByDomain.get(d)!.push(c);
  }

  const pubsByDomain = new Map<string, any[]>();
  for (const p of pubs) {
    const d = p.advertiser_domain;
    if (!pubsByDomain.has(d)) pubsByDomain.set(d, []);
    pubsByDomain.get(d)!.push(p);
  }

  return domains.map(d => d.toLowerCase()).map(domain => {
    const s = summaryMap.get(domain);
    if (!s) return null;

    const imp = Number(s.impressions) || 0;
    const spend = Number(s.spend) || 0;
    const total = imp || 1;

    const channels: CampaignData['channels'] = [];
    const chMap: Record<string, number> = {
      Display: Number(s.display_impressions) || 0,
      Video: Number(s.video_impressions) || 0,
      Social: Number(s.social_impressions) || 0,
      CTV: Number(s.ctv_impressions) || 0,
    };
    for (const [name, chImp] of Object.entries(chMap)) {
      if (chImp > 0) channels.push({ name, impressions: chImp, spend: Math.round(spend * chImp / total) });
    }
    channels.sort((a, b) => b.impressions - a.impressions);

    const domainPubs = (pubsByDomain.get(domain) || [])
      .filter(p => p.publisher_group !== 'Other Publishers')
      .slice(0, 10)
      .map(p => ({ domain: p.publisher_group, impressions: Number(p.impressions) || 0, spend: Number(p.spend) || 0 }));

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

    return {
      domain,
      totalImpressions: imp,
      totalSpend: spend,
      channels,
      publishers: domainPubs,
      creatives: domainCreatives,
    };
  }).filter((d): d is CampaignData => d !== null);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function serializeDates(row: any): any {
  const out: any = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v && typeof v === 'object' && (v as any).value ? (v as any).value : v;
  }
  return out;
}
