/**
 * CcrReport — side-by-side competitor campaign comparison.
 *
 * Shows brand card (highlighted) + competitor cards.
 * Each card: screenshot, metrics (impressions, CPM, spend), channels, publishers.
 * Bottom: LLM-generated narrative section.
 */
import { renderMarkdown } from '@AiDigital-com/design-system/utils';
import type { CcrReportData, CampaignData } from '../lib/types';

interface Props {
  data: CcrReportData;
}

export function CcrReport({ data }: Props) {
  return (
    <div className="ccr-report">
      <div className="ccr-report__header">
        <h2 className="ccr-report__title">
          Campaign Intelligence: <span className="ccr-report__brand">{data.brand.domain}</span>
        </h2>
        <p className="ccr-report__subtitle">
          Compared against {data.competitors.length} competitor{data.competitors.length !== 1 ? 's' : ''} · {formatDate(data.generatedAt)}
        </p>
      </div>

      <div className="ccr-report__grid">
        <CampaignCard data={data.brand} isBrand />
        {data.competitors.map(c => (
          <CampaignCard key={c.domain} data={c} isBrand={false} />
        ))}
      </div>

      {data.narrative && (
        <div className="ccr-report__narrative">
          <h3 className="ccr-report__narrative-title">Strategic Analysis</h3>
          <div
            className="ccr-report__narrative-body"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(data.narrative) }}
          />
        </div>
      )}
    </div>
  );
}

// ── Campaign card ─────────────────────────────────────────────────────────────

interface CardProps {
  data: CampaignData;
  isBrand: boolean;
}

function CampaignCard({ data, isBrand }: CardProps) {
  const cpm = data.totalImpressions > 0
    ? (data.totalSpend / data.totalImpressions) * 1000
    : null;

  const hasMetrics = data.totalImpressions > 0 || data.totalSpend > 0;

  return (
    <div className={`ccr-card${isBrand ? ' ccr-card--brand' : ''}`}>
      <div className="ccr-card__header">
        {isBrand && <span className="ccr-card__badge">Your Brand</span>}
        <h3 className="ccr-card__domain">{data.domain}</h3>
        {data.scrapedTitle && (
          <p className="ccr-card__title">{data.scrapedTitle}</p>
        )}
      </div>

      {data.screenshotUrl && (
        <div className="ccr-card__screenshot">
          <img
            src={data.screenshotUrl}
            alt={`${data.domain} homepage`}
            loading="lazy"
          />
        </div>
      )}

      {hasMetrics ? (
        <div className="ccr-card__metrics">
          <MetricItem label="Impressions" value={fmtNumber(data.totalImpressions)} />
          <MetricItem label="Est. Spend" value={`$${fmtMoney(data.totalSpend)}`} />
          {cpm !== null && (
            <MetricItem label="CPM" value={`$${cpm.toFixed(2)}`} />
          )}
        </div>
      ) : (
        <div className="ccr-card__no-data">No ad data in AdClarity dataset</div>
      )}

      {data.channels.length > 0 && (
        <div className="ccr-card__channels">
          {data.channels.slice(0, 5).map(c => (
            <span key={c.name} className="ccr-card__channel-pill">{c.name}</span>
          ))}
        </div>
      )}

      {data.publishers.length > 0 && (
        <div className="ccr-card__publishers">
          <p className="ccr-card__publishers-label">Top Publishers</p>
          <ul className="ccr-card__publishers-list">
            {data.publishers.slice(0, 5).map(p => (
              <li key={p.domain} className="ccr-card__publisher-item">
                <span className="ccr-card__publisher-domain">{p.domain}</span>
                <span className="ccr-card__publisher-imps">{fmtNumber(p.impressions)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.creatives.length > 0 && (
        <div className="ccr-card__creatives">
          <p className="ccr-card__creatives-label">Ad Creatives ({data.creatives.length})</p>
          <div className="ccr-card__creatives-grid">
            {data.creatives.slice(0, 4).map(c => (
              c.url ? (
                <a
                  key={c.id}
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ccr-card__creative-thumb"
                  title={`${c.channelName} · ${c.firstSeen}`}
                >
                  <img src={c.url} alt={`Creative ${c.id}`} loading="lazy" />
                </a>
              ) : null
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="ccr-metric">
      <span className="ccr-metric__label">{label}</span>
      <span className="ccr-metric__value">{value}</span>
    </div>
  );
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
    });
  } catch {
    return iso;
  }
}
