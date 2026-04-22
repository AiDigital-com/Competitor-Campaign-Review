export interface CcrIntake {
  brand_domain: string;
  source: 'url' | 'image';
}

export interface ChannelData {
  name: string;
  impressions: number;
  spend: number;
}

export interface PublisherData {
  domain: string;
  impressions: number;
  spend: number;
}

export interface CreativeData {
  id: string;
  url: string;
  mimeType: string;
  channelName: string;
  firstSeen: string;
  lastSeen?: string;
  impressions?: number;
  spend?: number;
  campaignName?: string;
  /** Impression-weighted CTR in percent (0.5 = 0.5%). Null when no click signal (CTV). */
  ctr?: number | null;
}

export interface CampaignData {
  domain: string;
  totalImpressions: number;
  totalSpend: number;
  /** Domain-level impression-weighted CTR in percent. Null when no click signal. */
  ctr?: number | null;
  channels: ChannelData[];
  publishers: PublisherData[];
  creatives: CreativeData[];
  screenshotUrl?: string | null;
  scrapedTitle?: string | null;
  scrapedDescription?: string | null;
  /** LLM-annotated: parent company name */
  parentCompany?: string;
  /** LLM-annotated: primary product line for this domain */
  productLine?: string;
}

export interface ActionItem {
  action: string;
  rationale: string;
}

export interface CcrInsights {
  executiveSummary: string;
  creativeActions: ActionItem[];
  spendingActions: ActionItem[];
  channelActions: ActionItem[];
}

export interface CcrReportData {
  brand: CampaignData;
  competitors: CampaignData[];
  narrative: string;
  insights?: CcrInsights;
  generatedAt: string;
}
