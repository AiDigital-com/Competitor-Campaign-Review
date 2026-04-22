/**
 * CCR report redesign — UI-side types.
 *
 * `CCRData` is the normalized shape consumed by the 6 variant views.
 * `normalize()` in `./data.ts` transforms the raw session `report_data`
 * into this shape, mirroring the prototype's `data.js` 1:1.
 */

export type Variant = 'v1' | 'v2' | 'v3' | 'v4' | 'v5' | 'v6' | 'method';
export type Mode = 'interactive' | 'public' | 'print';
export type Theme = 'dark' | 'light';
export type FX = 'default' | 'neuro' | 'showcase';
export type ChannelGroup = 'Video' | 'Social' | 'Display' | 'CTV' | 'Other';
export type CreativeType = 'video' | 'image' | 'unknown';

export interface ChannelMixGroup {
  group: ChannelGroup;
  hue: number;
  spend: number;
  impressions: number;
  count?: number;
}

export interface DecoratedChannel {
  name: string;
  impressions: number;
  spend: number;
  group: ChannelGroup;
}

export interface DecoratedCreative {
  id?: string;
  url: string;
  mimeType?: string;
  channelName?: string;
  campaignName?: string;
  firstSeen?: string;
  lastSeen?: string;
  impressions?: number;
  spend?: number;
  ctr?: number | null;
  type: CreativeType;
  poster: string | null;
  group: ChannelGroup;
  shortName: string;
  firstSeenLabel: string;
}

export interface DecoratedDomain {
  domain: string;
  host: string;
  productLine: string;
  parentCompany: string;
  totalSpend: number;
  totalImpressions: number;
  channels: DecoratedChannel[];
  channelGroups: ChannelMixGroup[];
  creatives: DecoratedCreative[];
  creativesByType: { video: number; image: number; other: number };
}

export interface BenchmarkRow {
  domain: string;
  host: string;
  isBrand: boolean;
  totalSpend: number;
  totalImpressions: number;
  channelGroups: ChannelMixGroup[];
  productLine: string;
  parentCompany: string;
  sovSpend: number;
  sovImpr: number;
}

export interface DecoratedCampaign {
  domain: string;
  host: string;
  isBrand: boolean;
  creative_campaign_name?: string;
  shortName: string;
  channel_name?: string;
  channelGroup: ChannelGroup;
  spend?: number;
  impressions?: number;
  ctr?: number | null;
  ctrPct?: number | null;
  creative_count?: number;
  publisher_count?: number;
  first_seen?: string;
  last_seen?: string;
  firstSeenLabel: string;
  lastSeenLabel: string;
  landing_page_url?: string;
}

export interface DecoratedPublisher {
  publisher: string;
  host: string;
  displayHost: string;
  isApp: boolean;
  spend?: number;
  impressions?: number;
  videoImpressions?: number;
  socialImpressions?: number;
  displayImpressions?: number;
  ctvImpressions?: number;
  hasVideo: boolean;
  hasSocial: boolean;
  hasDisplay: boolean;
  hasCtv: boolean;
  advertiserDomain?: string;
  advertiserHost?: string;
  isBrand?: boolean;
}

export interface PublisherRollup {
  host: string;
  displayHost: string;
  isApp: boolean;
  rows: DecoratedPublisher[];
  totalSpend: number;
  totalImpressions: number;
  advertiserCount: number;
  hasVideo: boolean;
  hasSocial: boolean;
  hasDisplay: boolean;
  hasCtv: boolean;
}

export interface DecoratedLandingPage {
  url: string;
  title?: string;
  description?: string;
  screenshotUrl?: string | null;
  domain?: string;
  campaignName?: string;
  host: string;
  isBrand: boolean;
  shortTitle: string;
  shortCampaign: string;
  advertiserDomain?: string;
}

export interface Overall {
  brandDomain: string;
  brandHost: string;
  parentCompany: string;
  productLine: string;
  competitorCount: number;
  candidateCount: number;
  totalBrandSpend: number;
  totalBrandImpressions: number;
  totalCompetitorSpend: number;
  totalCompetitorImpressions: number;
  totalCreatives: number;
  totalPublishers: number;
  totalCampaigns: number;
  scanDate?: string;
  scanDateLabel: string;
  brandSovSpend: number;
  brandSovImpr: number;
  leaderDomain: string;
  brandRank: number;
}

export interface CCRData {
  overall: Overall;
  brand: DecoratedDomain | null;
  competitors: DecoratedDomain[];
  benchmarkRows: BenchmarkRow[];
  maxBenchmarkSpend: number;
  maxBenchmarkImpr: number;
  allCampaigns: DecoratedCampaign[];
  brandCampaigns: DecoratedCampaign[];
  competitorCampaigns: DecoratedCampaign[];
  brandPublishers: DecoratedPublisher[];
  competitorPublishers: Record<string, DecoratedPublisher[]>;
  publisherList: PublisherRollup[];
  landingPages: DecoratedLandingPage[];
  brandLandingPages: DecoratedLandingPage[];
  annotations: Record<string, { parentCompany?: string; productLine?: string }>;
  verifiedDomains: string[];
  candidateDomains: string[];
}

/** The raw report_data shape — extends the current CcrReportData with the
 *  fields the pipeline writes beyond brand/competitors/narrative. */
export interface RawCcrReportData {
  brand?: Record<string, unknown>;
  competitors?: Record<string, unknown>[];
  brandDomain?: string;
  narrative?: string;
  generatedAt?: string;
  annotations?: Record<string, { parentCompany?: string; productLine?: string }>;
  summaries?: Record<string, {
    totalSpend?: number;
    totalImpressions?: number;
    channels?: { name: string; spend?: number; impressions?: number }[];
  }>;
  verifiedDomains?: string[];
  candidateDomains?: string[];
  topCampaigns?: Record<string, Record<string, unknown>[]>;
  publishersByDomain?: Record<string, Record<string, unknown>[]>;
  landingPages?: Record<string, unknown>[];
}
