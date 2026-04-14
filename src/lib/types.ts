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

export interface CcrReportData {
  brand: CampaignData;
  competitors: CampaignData[];
  narrative: string;
  generatedAt: string;
}
