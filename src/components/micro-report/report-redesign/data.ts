/**
 * CCR redesign — normalizer.
 *
 * Ported 1:1 from the handoff prototype's `data.js`. Given the raw
 * `report_data` the ccr-pipeline writes, produce a single `CCRData`
 * shape the 6 variant views consume.
 *
 * Key derivations:
 *  - benchmarkRows: brand + verifiedDomains from `summaries`, sorted by spend
 *  - allCampaigns / brandCampaigns / competitorCampaigns: flat + tagged
 *  - publisherList: rolled up across advertisers for V5 contested/exclusive
 *  - overall: portfolio-level rollups + brand SOV + rank
 *  - clicks: impressions × ctr / 100 (per-campaign, summed)
 */

import type {
  CCRData,
  ChannelMixGroup,
  DecoratedCampaign,
  DecoratedCreative,
  DecoratedDomain,
  DecoratedLandingPage,
  DecoratedPublisher,
  BenchmarkRow,
  PublisherRollup,
  RawCcrReportData,
  ChannelGroup,
} from './types';
import { CH_GROUPS, CH_HUE, coarseChannel } from './channels';

// ---------- Formatting helpers (exported — used by views) ----------
export const fmtCurrency = (v: number | null | undefined): string => {
  if (v == null || isNaN(v)) return '—';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(v);
};

export const fmtCompact = (v: number | null | undefined): string => {
  if (v == null || isNaN(v)) return '—';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(Math.round(v));
};

export const fmtInt = (v: number | null | undefined): string =>
  v == null || isNaN(v) ? '—' : Math.round(v).toLocaleString('en-US');

export const fmtPct = (v: number | null | undefined): string => {
  if (v == null || isNaN(v)) return '—';
  return (v >= 10 ? Math.round(v) : Number(v.toFixed(1))) + '%';
};

export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '—';
  }
};

export const domainHost = (d: string | null | undefined): string =>
  (d || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*/, '');

export const campaignShortName = (name: string | null | undefined): string => {
  if (!name) return 'Untitled';
  return name
    .replace(/\s*:\s*\d{2}\s*:\s*\d{2}-\d{2}-\d{2}\s*\d{4}\s*$/, '')
    .replace(/\s*\|\s*Coca-Cola US\s*$/, '')
    .replace(/\s*\|\s*Pepsi NA\s*$/, '')
    .slice(0, 70);
};

// ---------- Creative type inference ----------
function creativeType(c: Record<string, unknown>): 'video' | 'image' | 'unknown' {
  const mt = String(c.mimeType || '').toLowerCase();
  const url = String(c.url || '').toLowerCase();
  if (mt.includes('video') || /\.(mp4|webm|mov)(\?|$)/.test(url)) return 'video';
  if (mt.includes('image') || (mt === 'application/json' && /\.(jpe?g|png|gif|webp)(\?|$)/.test(url))) return 'image';
  if (/\.(jpe?g|png|gif|webp)(\?|$)/.test(url)) return 'image';
  if (/\.(mp4|webm|mov)(\?|$)/.test(url)) return 'video';
  return 'unknown';
}

function creativePoster(c: Record<string, unknown>): string | null {
  return creativeType(c) === 'image' ? ((c.url as string) || null) : null;
}

// ---------- Creative row merge (multi-channel consolidation) ----------
/**
 * AdClarity (and the ccr pipeline) reports one row per (creative, channel)
 * pair — so a single creative that runs on Mobile Video + Desktop Video
 * shows up as two rows with the same id/url. For the Creative Library tile
 * we want ONE tile per asset with consolidated totals; for a per-channel
 * filter we want the slice's numbers. Merge by (id, url), sum spend +
 * impressions, impressions-weighted ctr, min firstSeen, max lastSeen.
 * Preserve per-channel breakdown in `_channels` for slice-level filtering.
 */
function mergeCreativeRows(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown> & { _channels: Array<{ group: string; name: string; spend: number; impressions: number; ctr: number | null }> }>();
  for (const c of rows) {
    const key = `${c.id || ''}|${c.url || ''}`;
    const slice = {
      group: coarseChannel((c.channelName as string) || ''),
      name: (c.channelName as string) || '',
      spend: Number(c.spend) || 0,
      impressions: Number(c.impressions) || 0,
      ctr: (c.ctr as number | null | undefined) ?? null,
    };
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...c, _channels: [slice] });
      continue;
    }
    existing._channels.push(slice);
    // Sum totals
    existing.spend = (Number(existing.spend) || 0) + slice.spend;
    existing.impressions = (Number(existing.impressions) || 0) + slice.impressions;
    // Impressions-weighted ctr across slices
    const totalImpr = existing._channels.reduce((a, s) => a + s.impressions, 0);
    existing.ctr = totalImpr > 0
      ? existing._channels.reduce((a, s) => a + s.impressions * (s.ctr ?? 0), 0) / totalImpr
      : null;
    // firstSeen: min (lexicographic works for ISO YYYY-MM-DD)
    const fsB = c.firstSeen as string | undefined;
    if (fsB && (!existing.firstSeen || fsB < (existing.firstSeen as string))) {
      existing.firstSeen = fsB;
    }
    // lastSeen: max
    const lsB = c.lastSeen as string | undefined;
    if (lsB && (!existing.lastSeen || lsB > (existing.lastSeen as string))) {
      existing.lastSeen = lsB;
    }
    // channelName for display: dominant channel (highest spend slice)
    const dominant = existing._channels.reduce((a, b) => (b.spend > a.spend ? b : a));
    existing.channelName = dominant.name;
  }
  return Array.from(byKey.values());
}

// ---------- Domain decoration ----------
function decorateDomain(
  dRow: Record<string, unknown> | null | undefined,
  annotations: Record<string, { parentCompany?: string; productLine?: string }>,
): DecoratedDomain | null {
  if (!dRow || !dRow.domain) return null;
  const domain = dRow.domain as string;
  const ann = annotations[domain] || {};
  const rawChannels = (dRow.channels as { name: string; spend?: number; impressions?: number }[]) || [];
  const channels = rawChannels.map((c) => ({
    name: c.name,
    spend: c.spend || 0,
    impressions: c.impressions || 0,
    group: coarseChannel(c.name),
  }));
  const channelGroups: ChannelMixGroup[] = CH_GROUPS.map((g) => {
    const inGroup = channels.filter((c) => c.group === g);
    return {
      group: g,
      hue: CH_HUE[g],
      spend: inGroup.reduce((a, c) => a + (c.spend || 0), 0),
      impressions: inGroup.reduce((a, c) => a + (c.impressions || 0), 0),
      count: inGroup.length,
    };
  }).filter((g) => g.spend > 0 || g.impressions > 0);

  const rawCreatives = (dRow.creatives as Record<string, unknown>[]) || [];
  const mergedCreatives = mergeCreativeRows(rawCreatives);
  const creatives: DecoratedCreative[] = mergedCreatives.map((c) => {
    const slices = ((c as { _channels?: Array<{ group: string; name: string; spend: number; impressions: number; ctr: number | null }> })._channels) || [];
    return {
      id: c.id as string | undefined,
      url: String(c.url || ''),
      mimeType: c.mimeType as string | undefined,
      channelName: c.channelName as string | undefined,
      campaignName: c.campaignName as string | undefined,
      firstSeen: c.firstSeen as string | undefined,
      lastSeen: c.lastSeen as string | undefined,
      impressions: c.impressions as number | undefined,
      spend: c.spend as number | undefined,
      ctr: (c.ctr as number | null | undefined) ?? null,
      type: creativeType(c),
      poster: creativePoster(c),
      group: coarseChannel((c.channelName as string) || ''),
      shortName: campaignShortName(c.campaignName as string),
      firstSeenLabel: fmtDate(c.firstSeen as string),
      channels: slices.map((s) => ({
        group: s.group as ChannelGroup,
        name: s.name,
        spend: s.spend,
        impressions: s.impressions,
        ctr: s.ctr,
      })),
    };
  });

  return {
    domain,
    host: domainHost(domain),
    productLine: (dRow.productLine as string) || ann.productLine || '',
    parentCompany: (dRow.parentCompany as string) || ann.parentCompany || '',
    totalSpend: (dRow.totalSpend as number) || 0,
    totalImpressions: (dRow.totalImpressions as number) || 0,
    channels,
    channelGroups,
    creatives,
    creativesByType: {
      video: creatives.filter((c) => c.type === 'video').length,
      image: creatives.filter((c) => c.type === 'image').length,
      other: creatives.filter((c) => c.type === 'unknown').length,
    },
  };
}

// ---------- Publisher decoration ----------
function decoratePublisher(p: Record<string, unknown>): DecoratedPublisher {
  const raw = String(p.publisher || '');
  let host = raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  let displayHost = host;
  let isApp = false;

  if (/^android:/.test(raw)) {
    isApp = true;
    const pkg = raw.replace(/^android:/, '');
    const tail = pkg.split('.').filter(Boolean).pop() || pkg;
    displayHost = tail.charAt(0).toUpperCase() + tail.slice(1) + ' (Android)';
    host = 'android:' + pkg;
  } else if (/^\d{6,}$/.test(raw)) {
    isApp = true;
    displayHost = 'iOS app · ' + raw;
    host = 'ios:' + raw;
  }

  return {
    publisher: raw,
    host,
    displayHost,
    isApp,
    spend: p.spend as number | undefined,
    impressions: p.impressions as number | undefined,
    videoImpressions: p.videoImpressions as number | undefined,
    socialImpressions: p.socialImpressions as number | undefined,
    displayImpressions: p.displayImpressions as number | undefined,
    ctvImpressions: p.ctvImpressions as number | undefined,
    hasVideo: Number(p.videoImpressions || 0) > 0,
    hasSocial: Number(p.socialImpressions || 0) > 0,
    hasDisplay: Number(p.displayImpressions || 0) > 0,
    hasCtv: Number(p.ctvImpressions || 0) > 0,
  };
}

/**
 * Normalize raw report_data into the `CCRData` shape consumed by the 6 views.
 */
export function normalize(rd: RawCcrReportData, scanDate?: string): CCRData {
  const annotations = rd.annotations || {};
  const brandDomain = rd.brandDomain || (rd.brand?.domain as string) || 'unknown.com';

  const brand = decorateDomain(rd.brand ?? null, annotations);
  const competitors = (rd.competitors || [])
    .map((c) => decorateDomain(c, annotations))
    .filter((x): x is DecoratedDomain => x !== null);

  const summaries = rd.summaries || {};
  const verifiedDomains = rd.verifiedDomains || [];
  const candidateDomains = rd.candidateDomains || [];

  // ---------- Benchmark rows ----------
  const benchmarkRows: BenchmarkRow[] = [brandDomain, ...verifiedDomains.filter((d) => d !== brandDomain)]
    .map((d) => {
      const s = summaries[d];
      if (!s) return null;
      const ann = annotations[d] || {};
      const rawChannels = s.channels || [];
      const channelGroups: ChannelMixGroup[] = CH_GROUPS.map((g) => {
        const inGroup = rawChannels.filter((c) => coarseChannel(c.name) === g);
        return {
          group: g,
          hue: CH_HUE[g],
          spend: inGroup.reduce((a, c) => a + (c.spend || 0), 0),
          impressions: inGroup.reduce((a, c) => a + (c.impressions || 0), 0),
        };
      }).filter((g) => g.spend > 0 || g.impressions > 0);
      return {
        domain: d,
        host: domainHost(d),
        isBrand: d === brandDomain,
        totalSpend: s.totalSpend || 0,
        totalImpressions: s.totalImpressions || 0,
        channelGroups,
        productLine: ann.productLine || '',
        parentCompany: ann.parentCompany || '',
        sovSpend: 0,
        sovImpr: 0,
      };
    })
    .filter((r): r is BenchmarkRow => r !== null)
    .sort((a, b) => (b.totalSpend || 0) - (a.totalSpend || 0));

  const maxBenchmarkSpend = Math.max(...benchmarkRows.map((r) => r.totalSpend || 0), 1);
  const maxBenchmarkImpr = Math.max(...benchmarkRows.map((r) => r.totalImpressions || 0), 1);

  // SOV
  const marketTotalSpend = benchmarkRows.reduce((a, r) => a + (r.totalSpend || 0), 0);
  const marketTotalImpr = benchmarkRows.reduce((a, r) => a + (r.totalImpressions || 0), 0);
  benchmarkRows.forEach((r) => {
    r.sovSpend = marketTotalSpend ? (r.totalSpend / marketTotalSpend) * 100 : 0;
    r.sovImpr = marketTotalImpr ? (r.totalImpressions / marketTotalImpr) * 100 : 0;
  });

  // ---------- Campaigns ----------
  const topCampaignsByDomain = rd.topCampaigns || {};
  const allCampaigns: DecoratedCampaign[] = Object.entries(topCampaignsByDomain)
    .flatMap(([domain, list]) =>
      (list || []).map((c) => {
        const channelGroup = coarseChannel(c.channel_name as string);
        const ctr = c.ctr as number | null | undefined;
        return {
          ...c,
          domain,
          host: domainHost(domain),
          isBrand: domain === brandDomain,
          creative_campaign_name: c.creative_campaign_name as string | undefined,
          shortName: campaignShortName(c.creative_campaign_name as string),
          channel_name: c.channel_name as string | undefined,
          channelGroup,
          spend: c.spend as number | undefined,
          impressions: c.impressions as number | undefined,
          ctr: ctr ?? null,
          ctrPct: ctr == null ? null : (ctr as number),
          creative_count: c.creative_count as number | undefined,
          publisher_count: c.publisher_count as number | undefined,
          first_seen: c.first_seen as string | undefined,
          last_seen: c.last_seen as string | undefined,
          firstSeenLabel: fmtDate(c.first_seen as string),
          lastSeenLabel: fmtDate(c.last_seen as string),
          landing_page_url: c.landing_page_url as string | undefined,
        } as DecoratedCampaign;
      }),
    )
    .sort((a, b) => (b.spend || 0) - (a.spend || 0));

  const brandCampaigns = allCampaigns.filter((c) => c.isBrand);
  const competitorCampaigns = allCampaigns.filter((c) => !c.isBrand);

  // ---------- Publishers ----------
  const publishersByDomain = rd.publishersByDomain || {};
  const brandPublishers = (publishersByDomain[brandDomain] || []).map(decoratePublisher);
  const competitorPublishers: Record<string, DecoratedPublisher[]> = {};
  Object.entries(publishersByDomain)
    .filter(([d]) => d !== brandDomain)
    .forEach(([d, list]) => {
      competitorPublishers[d] = (list || []).map(decoratePublisher);
    });

  const allPublisherRows: DecoratedPublisher[] = Object.entries(publishersByDomain).flatMap(([domain, list]) =>
    (list || []).map((p) => {
      const dec = decoratePublisher(p);
      return {
        ...dec,
        advertiserDomain: domain,
        advertiserHost: domainHost(domain),
        isBrand: domain === brandDomain,
      };
    }),
  );

  const publisherMap: Record<string, PublisherRollup> = {};
  allPublisherRows.forEach((p) => {
    const h = p.host;
    if (!h || h === '—') return;
    if (!publisherMap[h]) {
      publisherMap[h] = {
        host: h,
        displayHost: p.displayHost || h,
        isApp: !!p.isApp,
        rows: [],
        totalSpend: 0,
        totalImpressions: 0,
        advertiserCount: 0,
        hasCtv: false,
        hasVideo: false,
        hasSocial: false,
        hasDisplay: false,
      };
    }
    publisherMap[h].rows.push(p);
    publisherMap[h].totalSpend += p.spend || 0;
    publisherMap[h].totalImpressions += p.impressions || 0;
    if (p.hasCtv) publisherMap[h].hasCtv = true;
    if (p.hasVideo) publisherMap[h].hasVideo = true;
    if (p.hasSocial) publisherMap[h].hasSocial = true;
    if (p.hasDisplay) publisherMap[h].hasDisplay = true;
  });
  Object.values(publisherMap).forEach((p) => {
    p.advertiserCount = new Set(p.rows.map((r) => r.advertiserDomain)).size;
  });
  const publisherList = Object.values(publisherMap).sort((a, b) => b.totalSpend - a.totalSpend);

  // ---------- Landing pages ----------
  const landingPages: DecoratedLandingPage[] = (rd.landingPages || []).map((lp) => {
    const domain = (lp.domain as string) || (lp.url as string) || '';
    return {
      url: String(lp.url || ''),
      title: lp.title as string | undefined,
      description: lp.description as string | undefined,
      screenshotUrl: (lp.screenshotUrl as string | null | undefined) ?? null,
      domain: lp.domain as string | undefined,
      campaignName: lp.campaignName as string | undefined,
      host: domainHost(domain),
      isBrand: (lp.domain || '') === brandDomain,
      shortTitle: String(lp.title || '')
        .replace(/\s*\|\s*Coca-Cola US\s*$/, '')
        .replace(/\s*\|\s*Pepsi NA\s*$/, '')
        .slice(0, 80),
      shortCampaign: campaignShortName(lp.campaignName as string),
      advertiserDomain: (lp.advertiserDomain as string) || (lp.domain as string) || undefined,
    };
  });

  const brandLandingPages = landingPages.filter((lp) => lp.isBrand);

  // ---------- Overall ----------
  const totalCreatives =
    (brand?.creatives?.length || 0) + competitors.reduce((a, c) => a + (c.creatives?.length || 0), 0);
  const totalPublishers = new Set(allPublisherRows.map((p) => p.host)).size;

  const leader = benchmarkRows[0];
  const brandRow = benchmarkRows.find((r) => r.isBrand);
  const brandRank = benchmarkRows.findIndex((r) => r.isBrand) + 1;

  const overall = {
    brandDomain,
    brandHost: domainHost(brandDomain),
    parentCompany: brand?.parentCompany || '',
    productLine: brand?.productLine || '',
    competitorCount: competitors.length,
    candidateCount: candidateDomains.length,
    totalBrandSpend: brand?.totalSpend || 0,
    totalBrandImpressions: brand?.totalImpressions || 0,
    totalCompetitorSpend: competitors.reduce((a, c) => a + (c.totalSpend || 0), 0),
    totalCompetitorImpressions: competitors.reduce((a, c) => a + (c.totalImpressions || 0), 0),
    totalCreatives,
    totalPublishers,
    totalCampaigns: allCampaigns.length,
    scanDate,
    scanDateLabel: fmtDate(scanDate),
    brandSovSpend: brandRow?.sovSpend || 0,
    brandSovImpr: brandRow?.sovImpr || 0,
    leaderDomain: leader?.domain || brandDomain,
    brandRank,
  };

  return {
    overall,
    brand,
    competitors,
    benchmarkRows,
    maxBenchmarkSpend,
    maxBenchmarkImpr,
    allCampaigns,
    brandCampaigns,
    competitorCampaigns,
    brandPublishers,
    competitorPublishers,
    publisherList,
    landingPages,
    brandLandingPages,
    annotations,
    verifiedDomains,
    candidateDomains,
  };
}

/** Compute the blended, impression-weighted CTR across a campaign list, plus
 *  the derived click count. Returns { ctr, clicks, clickedImpressions } where
 *  ctr is null when no campaigns carry a CTR signal. */
export function computeBlendedCtr(campaigns: DecoratedCampaign[]): {
  ctr: number | null;
  clicks: number;
  clickedImpressions: number;
} {
  let clickedImpressions = 0;
  let clicks = 0;
  campaigns.forEach((c) => {
    if (c.ctr != null && c.impressions) {
      clickedImpressions += c.impressions;
      clicks += (c.ctr / 100) * c.impressions;
    }
  });
  const ctr = clickedImpressions ? (clicks / clickedImpressions) * 100 : null;
  return { ctr, clicks, clickedImpressions };
}

/** Convenience: re-export coarseChannel + channel constants so views only need one import. */
export { CH_GROUPS, CH_HUE, coarseChannel };
export type { ChannelGroup };
