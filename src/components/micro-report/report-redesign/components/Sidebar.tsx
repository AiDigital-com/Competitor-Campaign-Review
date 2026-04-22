import type { CCRData, Variant } from '../types';
import { fmtCurrency, fmtCompact } from '../data';
import { HostMark } from './HostMark';

type Props = {
  data: CCRData;
  variant: Variant;
  onNavigate: (target: Variant) => void;
  onFocusDomain: (domain: string) => void;
  brandLabel: string;
};

const NAV: { v: Variant; n: string; label: string }[] = [
  { v: 'v1', n: '01', label: 'Cockpit' },
  { v: 'v2', n: '02', label: 'Creative library' },
  { v: 'v3', n: '03', label: 'Top campaigns' },
  { v: 'v4', n: '04', label: 'Competitive matrix' },
  { v: 'v5', n: '05', label: 'Publisher map' },
  { v: 'v6', n: '06', label: 'Landing pages' },
  { v: 'method', n: '07', label: 'Methodology' },
];

function pillFor(v: Variant, data: CCRData): string {
  switch (v) {
    case 'v1':
      return `#${data.overall.brandRank || '—'}`;
    case 'v2':
      return String(data.overall.totalCreatives);
    case 'v3':
      return String(data.allCampaigns.length);
    case 'v4':
      return String(data.benchmarkRows.length);
    case 'v5':
      return String(data.overall.totalPublishers);
    case 'v6':
      return String(data.landingPages.length);
    default:
      return '—';
  }
}

/**
 * CCR sidebar — brand card, view nav with counts, advertiser benchmark list,
 * scan stats, and footer meta.
 */
export function Sidebar({ data, variant, onNavigate, onFocusDomain, brandLabel }: Props) {
  return (
    <aside className="report-sidebar" data-sidebar>
      <div className="rs-head">
        <div className="rs-eyebrow">Cross-Channel Creative</div>
        <h1 className="rs-brand">{brandLabel}</h1>
        <div className="rs-asset">
          {data.overall.productLine || 'Brand scan'} · {data.overall.scanDateLabel}
        </div>
      </div>

      <div className="rs-nav">
        <div className="rs-group-label">Views</div>
        {NAV.map((it) => (
          <button
            key={it.v}
            className={`rs-item ${it.v === variant ? 'active' : ''}`}
            onClick={() => onNavigate(it.v)}
          >
            <span className="label">
              <span className="n">{it.n}</span>
              {it.label}
            </span>
            <span className="pill-mini">{pillFor(it.v, data)}</span>
          </button>
        ))}

        <div className="rs-group-label">Advertisers</div>
        <div className="ccr-domain-list">
          {data.benchmarkRows.slice(0, 8).map((r) => (
            <button
              key={r.domain}
              className={`ccr-domain-row ${r.isBrand ? 'is-brand' : ''}`}
              onClick={() => onFocusDomain(r.domain)}
              title={r.host}
            >
              <HostMark host={r.host} />
              <span className="ccr-domain-rowtext">
                <span className="ccr-domain-name">{r.host}</span>
                <span className="ccr-domain-sub">
                  {fmtCurrency(r.totalSpend)} · {fmtCompact(r.totalImpressions)} impr
                </span>
              </span>
              {r.isBrand && <span className="ccr-brand-tag">BRAND</span>}
            </button>
          ))}
        </div>

        <div className="rs-group-label">Scan</div>
        <div className="aio-scanchip">
          <div className="aio-scanchip-row">
            <span>Competitors</span>
            <b>{data.overall.competitorCount}</b>
          </div>
          <div className="aio-scanchip-row">
            <span>Creatives</span>
            <b>{data.overall.totalCreatives}</b>
          </div>
          <div className="aio-scanchip-row">
            <span>Campaigns</span>
            <b>{data.overall.totalCampaigns}</b>
          </div>
          <div className="aio-scanchip-row">
            <span>Publishers</span>
            <b>{data.overall.totalPublishers}</b>
          </div>
        </div>
      </div>

      <div className="rs-meta">
        <div>Scan · {data.overall.scanDateLabel}</div>
      </div>
    </aside>
  );
}
