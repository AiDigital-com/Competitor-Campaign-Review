import { useMemo } from 'react';
import type { CCRData, PublisherRollup } from '../types';
import { fmtCurrency, fmtCompact } from '../data';
import { HostMark, HostBadge } from '../components/HostMark';
import { HBar } from '../components/ChannelMixBar';
import { useLocalStorage } from '../hooks';

type Props = { data: CCRData };
type ChanFilter = 'all' | 'video' | 'social' | 'display' | 'ctv';

/**
 * V5 — Publisher Map. Ranked publishers, contested inventory (2+ advertisers
 * bidding), and exclusive inventory (one advertiser only — whitespace or moat).
 */
export function PublisherMap({ data }: Props) {
  const [chan, setChan] = useLocalStorage<ChanFilter>('ccr-pub-chan', 'all');

  const pubsAll = data.publisherList;
  const pubs = useMemo(() => {
    if (chan === 'all') return pubsAll;
    if (chan === 'video') return pubsAll.filter((p) => p.hasVideo);
    if (chan === 'social') return pubsAll.filter((p) => p.hasSocial);
    if (chan === 'display') return pubsAll.filter((p) => p.hasDisplay);
    if (chan === 'ctv') return pubsAll.filter((p) => p.hasCtv);
    return pubsAll;
  }, [pubsAll, chan]);

  const maxSpend = Math.max(...pubs.map((p) => p.totalSpend), 1);
  const shared = pubs.filter((p) => p.advertiserCount > 1);

  const exclusive = useMemo(() => {
    const out: Record<string, { host: string; isBrand: boolean; pubs: PublisherRollup[] }> = {};
    pubs
      .filter((p) => p.advertiserCount === 1)
      .forEach((p) => {
        const row = p.rows[0];
        if (!row?.advertiserDomain) return;
        const key = row.advertiserDomain;
        if (!out[key]) {
          out[key] = { host: row.advertiserHost || key, isBrand: !!row.isBrand, pubs: [] };
        }
        out[key].pubs.push(p);
      });
    return out;
  }, [pubs]);

  const cc = {
    all: pubsAll.length,
    video: pubsAll.filter((p) => p.hasVideo).length,
    social: pubsAll.filter((p) => p.hasSocial).length,
    display: pubsAll.filter((p) => p.hasDisplay).length,
    ctv: pubsAll.filter((p) => p.hasCtv).length,
  };

  const top = pubsAll[0];

  return (
    <div className="v5-body">
      <header className="ccr-view-head">
        <div className="ccr-view-head-lead">
          <div className="ccr-eyebrow">05 · Publisher Map</div>
          <h1 className="ccr-view-title">Where the spend lands</h1>
          <p className="ccr-view-sub">
            {pubsAll.length} publishers · {data.benchmarkRows.length} advertisers · aggregated from per-advertiser supply paths
          </p>
        </div>
        <div className="ccr-view-head-stats">
          <div className="ccr-stat">
            <label>Top publisher</label>
            <b>{top?.displayHost || top?.host || '—'}</b>
          </div>
          <div className="ccr-stat">
            <label>Combined spend</label>
            <b>{fmtCurrency(pubsAll.reduce((a, p) => a + p.totalSpend, 0))}</b>
          </div>
          <div className="ccr-stat">
            <label>Contested</label>
            <b>{pubsAll.filter((p) => p.advertiserCount > 1).length}</b>
          </div>
        </div>
      </header>

      <div className="ccr-filterbar slim">
        <div className="ccr-filter-group">
          <label>Inventory</label>
          <div className="ccr-seg">
            <button
              className={`ccr-seg-btn ${chan === 'all' ? 'active' : ''}`}
              onClick={() => setChan('all')}
            >
              All <span className="ccr-seg-count">{cc.all}</span>
            </button>
            <button
              className={`ccr-seg-btn ${chan === 'video' ? 'active' : ''}`}
              onClick={() => setChan('video')}
            >
              <span className="ccr-chan-dot" style={{ '--hue': 280 } as React.CSSProperties} />
              Video <span className="ccr-seg-count">{cc.video}</span>
            </button>
            <button
              className={`ccr-seg-btn ${chan === 'social' ? 'active' : ''}`}
              onClick={() => setChan('social')}
            >
              <span className="ccr-chan-dot" style={{ '--hue': 195 } as React.CSSProperties} />
              Social <span className="ccr-seg-count">{cc.social}</span>
            </button>
            <button
              className={`ccr-seg-btn ${chan === 'display' ? 'active' : ''}`}
              onClick={() => setChan('display')}
            >
              <span className="ccr-chan-dot" style={{ '--hue': 25 } as React.CSSProperties} />
              Display <span className="ccr-seg-count">{cc.display}</span>
            </button>
            <button
              className={`ccr-seg-btn ${chan === 'ctv' ? 'active' : ''}`}
              onClick={() => setChan('ctv')}
            >
              <span className="ccr-chan-dot" style={{ '--hue': 155 } as React.CSSProperties} />
              CTV <span className="ccr-seg-count">{cc.ctv}</span>
            </button>
          </div>
        </div>
      </div>

      <section className="ccr-section no-top">
        <div className="ccr-section-head">
          <h2>Ranked by spend</h2>
          <div className="ccr-section-sub">
            {pubs.length} publisher{pubs.length === 1 ? '' : 's'} · sorted by combined spend across the set
          </div>
        </div>
        <div className="ccr-pub-list">
          <div className="ccr-pub-head">
            <div className="p-rank">#</div>
            <div className="p-host">Publisher</div>
            <div className="p-spend">Spend</div>
            <div className="p-impr">Impressions</div>
            <div className="p-adv">Advertisers</div>
            <div className="p-types">Inventory</div>
          </div>
          {pubs.map((p, i) => (
            <div key={p.host} className="ccr-pub-row">
              <div className="p-rank">{i + 1}</div>
              <div className="p-host">
                <HostMark host={p.displayHost || p.host} isApp={p.isApp} />
                <span className="ccr-pub-name">{p.displayHost || p.host}</span>
              </div>
              <div className="p-spend">
                <b>{fmtCurrency(p.totalSpend)}</b>
                <HBar value={p.totalSpend} max={maxSpend} kind="spend" width={160} />
              </div>
              <div className="p-impr">{fmtCompact(p.totalImpressions)}</div>
              <div className="p-adv">
                <div className="ccr-pub-adv">
                  {p.rows
                    .slice()
                    .sort((a, b) => (b.spend || 0) - (a.spend || 0))
                    .map((r) => (
                      <span
                        key={r.advertiserDomain}
                        className={`ccr-pub-adv-chip ${r.isBrand ? 'is-brand' : ''}`}
                        title={`${r.advertiserHost}: ${fmtCurrency(r.spend)}`}
                      >
                        {(r.advertiserHost || '').slice(0, 2).toUpperCase()}
                      </span>
                    ))}
                </div>
                <span className="muted">
                  {p.advertiserCount} advertiser{p.advertiserCount > 1 ? 's' : ''}
                </span>
              </div>
              <div className="p-types">
                {p.hasVideo && <span className="ccr-inv-chip video">VIDEO</span>}
                {p.hasSocial && <span className="ccr-inv-chip social">SOCIAL</span>}
                {p.hasDisplay && <span className="ccr-inv-chip display">DISPLAY</span>}
                {p.hasCtv && <span className="ccr-inv-chip ctv">CTV</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      {shared.length > 0 && (
        <section className="ccr-section">
          <div className="ccr-section-head">
            <h2>Contested inventory</h2>
            <div className="ccr-section-sub">
              Publishers where 2+ advertisers are bidding for the same audience · {shared.length} publisher
              {shared.length === 1 ? '' : 's'}
            </div>
          </div>
          <div className="ccr-shared-grid">
            {shared.slice(0, 18).map((p) => (
              <div key={p.host} className="ccr-shared-card">
                <div className="ccr-shared-host">
                  <HostMark host={p.displayHost || p.host} />
                  <span className="ccr-pub-name">{p.displayHost || p.host}</span>
                </div>
                <div className="ccr-shared-total">{fmtCurrency(p.totalSpend)}</div>
                <div className="ccr-shared-rows">
                  {p.rows
                    .slice()
                    .sort((a, b) => (b.spend || 0) - (a.spend || 0))
                    .map((r) => (
                      <div
                        key={r.advertiserDomain}
                        className={`ccr-shared-row ${r.isBrand ? 'is-brand' : ''}`}
                      >
                        <span className="host">{r.advertiserHost}</span>
                        <span className="spend">{fmtCurrency(r.spend)}</span>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {Object.keys(exclusive).length > 0 && (
        <section className="ccr-section">
          <div className="ccr-section-head">
            <h2>Exclusive to one advertiser</h2>
            <div className="ccr-section-sub">
              Publishers bought by only one advertiser in the set · whitespace or moat, depending on side
            </div>
          </div>
          <div className="ccr-exclusive-cols">
            {Object.entries(exclusive).map(([advertiserDomain, { host, isBrand, pubs: xpubs }]) => (
              <div key={advertiserDomain} className={`ccr-exclusive-col ${isBrand ? 'is-brand' : ''}`}>
                <div className="ccr-exclusive-head">
                  <HostBadge host={host} isBrand={isBrand} />
                  <span className="muted">{xpubs.length} exclusive</span>
                </div>
                <div className="ccr-exclusive-list">
                  {xpubs.slice(0, 8).map((p) => (
                    <div key={p.host} className="ccr-exclusive-row">
                      <span className="host">{p.displayHost || p.host}</span>
                      <span className="spend">{fmtCurrency(p.totalSpend)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
