/**
 * AdClarity data access layer.
 *
 * One query pattern, two backends:
 * - Production: BigQuery (requires bigquery.jobUser)
 * - Development: Supabase relational tables (ccr_adv_summary, ccr_campaign_channel_detail, etc.)
 *
 * Both backends have identical schemas. The data access functions
 * work the same regardless of which backend is active.
 */
import { createClient as createSupabase } from '@supabase/supabase-js';
import type { CampaignData } from '../../../src/lib/types.js';

function getSupabase() {
  return createSupabase(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch summary data for domains. Returns one row per domain.
 */
export async function getAdSummary(domains: string[]): Promise<any[]> {
  const lower = domains.map(d => d.toLowerCase());
  const sb = getSupabase();
  const { data } = await sb.from('ccr_adv_summary').select('*').in('advertiser_domain', lower);
  return data || [];
}

/**
 * Fetch campaign × channel detail for domains.
 * Includes landing_page_url, impressions, spend, creative/publisher counts.
 */
export async function getCampaignDetail(domains: string[], limit = 50): Promise<any[]> {
  const lower = domains.map(d => d.toLowerCase());
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
 * Fetch creative detail for domains.
 * Includes creative URLs, landing pages, sizes, durations.
 */
export async function getCreativeDetail(domains: string[], limit = 50): Promise<any[]> {
  const lower = domains.map(d => d.toLowerCase());
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
  const sb = getSupabase();
  const { data } = await sb
    .from('ccr_expenditure_trend')
    .select('*')
    .in('advertiser_domain', lower)
    .order('month', { ascending: true });
  return data || [];
}

/**
 * Discover top ad competitors by impressions (excluding the brand).
 */
export async function discoverAdCompetitors(brandDomain: string, limit = 10): Promise<string[]> {
  const brand = brandDomain.toLowerCase();
  const sb = getSupabase();
  const { data } = await sb
    .from('ccr_adv_summary')
    .select('advertiser_domain, impressions')
    .neq('advertiser_domain', brand)
    .order('impressions', { ascending: false })
    .limit(limit);
  return (data || []).map(r => r.advertiser_domain);
}

/**
 * Build CampaignData objects for a set of domains.
 * Combines summary + creative detail + publishers.
 * Same output shape regardless of backend.
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
