import type { CCRData } from '../types';
import { CH_GROUPS, domainHost } from '../data';
import { ChannelPill } from '../components/ChannelPill';

type Props = { data: CCRData };

/**
 * Methodology — explains how CCR turns competitor-set ingestion into the
 * cross-channel report. Mirrors the handoff prototype's 6-card layout.
 */
export function Methodology({ data }: Props) {
  const withCtr = data.allCampaigns.filter((c) => c.ctr != null).length;
  const withShot = data.landingPages.filter((p) => p.screenshotUrl).length;
  const unverified = Math.max(0, data.overall.candidateCount - data.verifiedDomains.length);

  return (
    <div className="mth-body">
      <header className="ccr-view-head">
        <div className="ccr-view-head-lead">
          <div className="ccr-eyebrow">07 · Methodology</div>
          <h1 className="ccr-view-title">How CCR scans the market</h1>
          <p className="ccr-view-sub">Competitor discovery, channel normalization, creative deduplication.</p>
        </div>
        <div className="ccr-view-head-stats">
          <div className="ccr-stat">
            <label>Brand</label>
            <b>{data.overall.brandHost}</b>
          </div>
          <div className="ccr-stat">
            <label>Scanned</label>
            <b>{data.overall.scanDateLabel}</b>
          </div>
          <div className="ccr-stat">
            <label>App</label>
            <b>CCR</b>
          </div>
        </div>
      </header>

      <div className="ccr-method-grid">
        <div className="ccr-method-card">
          <div className="ccr-method-n">01</div>
          <h3>Competitor discovery</h3>
          <p>
            CCR seeds <b>{data.overall.candidateCount}</b> candidate domains from category taxonomy,
            advertiser overlap, and LLM world-knowledge. A Gemini classification step verifies
            <b> {data.verifiedDomains.length}</b> as true competitors by matching product line against
            the brand; the rest are dropped for this scan.
          </p>
          <div className="ccr-method-tags">
            {data.verifiedDomains.map((d) => (
              <span key={d} className="ccr-method-tag">
                {domainHost(d)}
              </span>
            ))}
          </div>
        </div>

        <div className="ccr-method-card">
          <div className="ccr-method-n">02</div>
          <h3>Channel normalization</h3>
          <p>
            Raw channel strings ({CH_GROUPS.length} coarse groups) are mapped from the ad intelligence feed.
            Video and CTV are separated — CTV is device-bound, Video includes desktop, mobile and in-app.
          </p>
          <div className="ccr-method-channels">
            {CH_GROUPS.map((g) => (
              <ChannelPill key={g} group={g} />
            ))}
          </div>
        </div>

        <div className="ccr-method-card">
          <div className="ccr-method-n">03</div>
          <h3>Creative deduplication</h3>
          <p>
            Creatives are hashed by creative ID, not URL — the same asset running on multiple channels is
            counted as one creative but spend is summed. Poster frames for videos are rendered from the
            creative gradient when firecrawl hasn't provided a thumbnail.
          </p>
          <div className="ccr-method-tags">
            <span className="ccr-method-tag">{data.overall.totalCreatives} creatives</span>
            <span className="ccr-method-tag">{data.brand?.creativesByType.video || 0} video · brand</span>
            <span className="ccr-method-tag">{data.brand?.creativesByType.image || 0} static · brand</span>
          </div>
        </div>

        <div className="ccr-method-card">
          <div className="ccr-method-n">04</div>
          <h3>Top campaigns</h3>
          <p>
            Campaigns are grouped by <code>creative_campaign_name</code> and ranked by measured spend in the
            lookback window. CTR is reported where the supply path provides a click signal — CTV campaigns
            have <b>no CTR</b> by design.
          </p>
          <div className="ccr-method-tags">
            <span className="ccr-method-tag">{data.allCampaigns.length} ranked</span>
            <span className="ccr-method-tag">{withCtr} with CTR</span>
          </div>
        </div>

        <div className="ccr-method-card">
          <div className="ccr-method-n">05</div>
          <h3>Landing pages</h3>
          <p>
            For each unique landing URL across top campaigns, CCR captures a screenshot and extracts markdown
            via Firecrawl. This gives a visual + textual fingerprint of the destination experience behind
            each creative.
          </p>
          <div className="ccr-method-tags">
            <span className="ccr-method-tag">{data.landingPages.length} pages</span>
            <span className="ccr-method-tag">{withShot} with screenshot</span>
          </div>
        </div>

        <div className="ccr-method-card ccr-method-limits">
          <div className="ccr-method-n">06</div>
          <h3>Known limits</h3>
          <ul>
            <li>Spend is modeled CPM × impressions from the ad intelligence feed — not billing data.</li>
            <li>
              CTV publishers are reported where impressions cross server-level thresholds; long-tail CTV may
              be missing.
            </li>
            <li>
              Creative identity is per-asset, not per-variant — A/B variants with different copy but the same
              media hash collapse.
            </li>
            <li>
              Candidate domains ({unverified} unverified) are omitted from benchmark, matrix and publisher
              views.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
