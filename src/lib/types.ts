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
  impressions?: number;
  spend?: number;
  campaignName?: string;
}

export interface CampaignData {
  domain: string;
  totalImpressions: number;
  totalSpend: number;
  channels: ChannelData[];
  publishers: PublisherData[];
  creatives: CreativeData[];
  screenshotUrl?: string | null;
  scrapedTitle?: string | null;
  scrapedDescription?: string | null;
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
