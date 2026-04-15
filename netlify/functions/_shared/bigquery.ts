/**
 * BigQuery / AdClarity helper.
 *
 * Two modes (cascading fallback):
 * 1. Query mode (requires bigquery.jobUser) — runs SQL against the raw table.
 * 2. Supabase training mode — reads cached AdClarity data from ccr_training_data.
 *    Training data mirrors the exact BQ pre-aggregated table schemas:
 *    adv_summary, adv_campaign_channel_summary, adv_creative,
 *    adv_publisher_channel_method, adv_expenditure_trend_month.
 *
 * Tries query → Supabase training.
 */
import { BigQuery } from '@google-cloud/bigquery';
import { createClient as createSupabase } from '@supabase/supabase-js';
import type { CampaignData } from '../../../src/lib/types.js';

function createBqClient(): BigQuery {
  const credentials = process.env.GOOGLE_CREDENTIALS
    ? JSON.parse(process.env.GOOGLE_CREDENTIALS)
    : {
        client_email: process.env.GCP_CLIENT_EMAIL!,
        private_key: process.env.GCP_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      };
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

function getSupabase() {
  return createSupabase(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch AdClarity campaign data for a set of domains.
 * Cascade: SQL query → Supabase training data.
 */
export async function getAdClarityData(domains: string[]): Promise<CampaignData[]> {
  const hasGcp = !!(process.env.GCP_PROJECT_ID && (process.env.GCP_PRIVATE_KEY || process.env.GOOGLE_CREDENTIALS));

  if (hasGcp) {
    try {
      const result = await queryMode(domains);
      if (result.length > 0) return result;
    } catch (err: any) {
      console.log('[AdClarity] Query mode failed:', (err as Error).message?.substring(0, 120));
    }
  }

  try {
    const result = await supabaseTrainingMode(domains);
    if (result.length > 0) {
      console.log(`[AdClarity] Training data: ${result.length} domains`);
      return result;
    }
  } catch (err) {
    console.log('[AdClarity] Training mode failed:', (err as Error).message);
  }

  console.log('[AdClarity] No data available — returning empty');
  return [];
}

/**
 * Discover top ad competitors from training data.
 * Returns domain names sorted by impressions (descending), excluding the brand.
 */
export async function discoverAdCompetitors(brandDomain: string, limit = 10): Promise<string[]> {
  const brand = brandDomain.toLowerCase();
  try {
    const sb = getSupabase();
    const { data: rows } = await sb
      .from('ccr_training_data')
      .select('advertiser_domain, data')
      .eq('data_type', 'adv_summary')
      .neq('advertiser_domain', brand);

    if (rows && rows.length > 0) {
      return rows
        .map(r => ({ domain: r.advertiser_domain, impressions: Number(r.data?.impressions) || 0 }))
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, limit)
        .map(r => r.domain);
    }
  } catch (err) {
    console.log('[discoverAdCompetitors] failed:', (err as Error).message);
  }
  return [];
}

// ── Query mode (full SQL — needs bigquery.jobUser) ──────────────────────────

async function queryMode(domains: string[]): Promise<CampaignData[]> {
  const bq = createBqClient();

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
        creative_campaign_name   AS campaign_name,
        MAX(impressions)         AS impressions,
        MAX(spend)               AS spend
      FROM ${tableRef()}
      WHERE LOWER(advertiser_domain) IN UNNEST(@domains)
        AND month >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH)
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
    )
    SELECT
      domain, channel, publisher, campaign_name,
      creative_id, creative_url, creative_mime_type, creative_first_seen,
      SUM(impressions) AS impressions,
      SUM(spend)       AS spend
    FROM deduped
    GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
    ORDER BY impressions DESC
  `;

  const [rows] = await bq.query({
    query,
    params: { domains: domains.map(d => d.toLowerCase()) },
    types: { domains: ['STRING'] },
  });

  return buildCampaignDataFromRaw(rows);
}

// ── Supabase training mode (mirrors BQ pre-aggregated tables) ───────────────

async function supabaseTrainingMode(domains: string[]): Promise<CampaignData[]> {
  const sb = getSupabase();
  const lowerDomains = domains.map(d => d.toLowerCase());

  const { data: rows, error } = await sb
    .from('ccr_training_data')
    .select('advertiser_domain, data_type, data')
    .in('advertiser_domain', lowerDomains);

  if (error) throw new Error(`Training query failed: ${error.message}`);
  if (!rows || rows.length === 0) return [];

  // Group by domain → data_type
  const byDomain = new Map<string, Record<string, any>>();
  for (const row of rows) {
    if (!byDomain.has(row.advertiser_domain)) byDomain.set(row.advertiser_domain, {});
    byDomain.get(row.advertiser_domain)![row.data_type] = row.data;
  }

  return Array.from(byDomain.entries()).map(([domain, tables]) => {
    // adv_summary → top-level metrics + channel breakdown
    const s = tables.adv_summary || {};
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

    // adv_publisher_channel_method → publishers
    const pubs: any[] = Array.isArray(tables.adv_publisher_channel_method) ? tables.adv_publisher_channel_method : [];

    // adv_creative → creatives (with campaign names + per-creative metrics)
    const crvs: any[] = Array.isArray(tables.adv_creative) ? tables.adv_creative : [];

    // adv_campaign_channel_summary → campaign metadata (channels, dates, rank)
    const campRows: any[] = Array.isArray(tables.adv_campaign_channel_summary) ? tables.adv_campaign_channel_summary : [];
    const campLookup = new Map<string, any>();
    for (const c of campRows) {
      campLookup.set(c.creative_campaign_name, c);
    }

    return {
      domain,
      totalImpressions: imp,
      totalSpend: spend,
      channels,
      publishers: pubs
        .map(r => ({
          domain: r.publisher_group || 'Unknown',
          impressions: Number(r.impressions) || 0,
          spend: Number(r.spend) || 0,
        }))
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 10),
      creatives: crvs
        .map(r => {
          const campName = r.all_campaigns || '';
          const campMeta = campLookup.get(campName);
          return {
            id: String(r.creative_id || ''),
            url: r.creative_url_supplier || '',
            mimeType: '',
            channelName: campMeta?.aggregated_channels || '',
            firstSeen: r.creative_first_seen || '',
            impressions: Number(r.impressions) || 0,
            spend: Number(r.spend) || 0,
            campaignName: campName,
          };
        })
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 20),
    };
  }).filter(d => d.totalImpressions > 0);
}

// ── Shared: build CampaignData from raw BQ query rows ───────────────────────

function buildCampaignDataFromRaw(rows: any[]): CampaignData[] {
  const byDomain = new Map<string, any[]>();
  for (const row of rows) {
    const key = (row.domain as string) ?? '';
    if (!byDomain.has(key)) byDomain.set(key, []);
    byDomain.get(key)!.push(row);
  }

  return Array.from(byDomain.entries()).map(([domain, domainRows]) => {
    const channelMap = new Map<string, { impressions: number; spend: number }>();
    const publisherMap = new Map<string, { impressions: number; spend: number }>();
    const creativeMap = new Map<string, { url: string; mimeType: string; channelName: string; firstSeen: string; impressions: number; spend: number; campaignName: string }>();

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
          impressions: imp,
          spend: spd,
          campaignName: (row.campaign_name as string) || '',
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
        .map(([id, d]) => ({ id, ...d }))
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 20),
    };
  });
}
