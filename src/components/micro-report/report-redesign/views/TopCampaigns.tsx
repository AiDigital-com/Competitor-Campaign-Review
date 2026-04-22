import { useMemo } from 'react';
import type { CCRData } from '../types';
import { fmtCurrency, fmtCompact, fmtPct } from '../data';
import { HostBadge } from '../components/HostMark';
import { ChannelPill } from '../components/ChannelPill';
import { HBar } from '../components/ChannelMixBar';
import { useLocalStorage } from '../hooks';

type Props = { data: CCRData };
type Filter = 'all' | 'brand' | 'competitors';

/**
 * V3 — Top Campaigns. Ranked list across brand + competitors, with filter
 * toggles. CTR column is populated for non-CTV campaigns (depends on
 * Stage A's per-campaign CTR in BigQuery).
 */
export function TopCampaigns({ data }: Props) {
  const [filter, setFilter] = useLocalStorage<Filter>('ccr-campaign-filter', 'all');

  const rows = useMemo(() => {
    const list = data.allCampaigns.slice();
    if (filter === 'brand') return list.filter((r) => r.isBrand);
    if (filter === 'competitors') return list.filter((r) => !r.isBrand);
    return list;
  }, [data.allCampaigns, filter]);

  const totalSpend = rows.reduce((a, r) => a + (r.spend || 0), 0);
  const maxImpr = Math.max(...rows.map((r) => r.impressions || 0), 1);
  const maxSpend = rows[0]?.spend || 1;

  return (
    <div className="v3-body">
      <header className="ccr-view-head">
        <div className="ccr-view-head-lead">
          <div className="ccr-eyebrow">03 · Top Campaigns</div>
          <h1 className="ccr-view-title">Biggest campaigns in the set</h1>
          <p className="ccr-view-sub">{rows.length} campaigns · ranked by measured spend</p>
        </div>
        <div className="ccr-view-head-stats">
          <div className="ccr-stat">
            <label>Combined spend</label>
            <b>{fmtCurrency(totalSpend)}</b>
          </div>
          <div className="ccr-stat">
            <label>Campaigns</label>
            <b>{rows.length}</b>
          </div>
          <div className="ccr-stat">
            <label>Brand share</label>
            <b>
              {data.brandCampaigns.length} / {data.allCampaigns.length}
            </b>
          </div>
        </div>
      </header>

      <div className="ccr-filterbar slim">
        <div className="ccr-filter-group">
          <label>Show</label>
          <div className="ccr-seg">
            <button
              className={`ccr-seg-btn ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All <span className="ccr-seg-count">{data.allCampaigns.length}</span>
            </button>
            <button
              className={`ccr-seg-btn ${filter === 'brand' ? 'active' : ''}`}
              onClick={() => setFilter('brand')}
            >
              Brand <span className="ccr-seg-count">{data.brandCampaigns.length}</span>
            </button>
            <button
              className={`ccr-seg-btn ${filter === 'competitors' ? 'active' : ''}`}
              onClick={() => setFilter('competitors')}
            >
              Competitors <span className="ccr-seg-count">{data.competitorCampaigns.length}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="ccr-campaign-list">
        <div className="ccr-campaign-head">
          <div className="c-rank">#</div>
          <div className="c-name">Campaign</div>
          <div className="c-channel">Channel</div>
          <div className="c-spend">Spend</div>
          <div className="c-impr">Impressions</div>
          <div className="c-ctr">CTR</div>
          <div className="c-creative">Creatives</div>
          <div className="c-dates">Run</div>
        </div>
        {rows.map((r, i) => (
          <div
            key={`${r.domain}-${r.creative_campaign_name || r.shortName}-${i}`}
            className={`ccr-campaign-row ${r.isBrand ? 'is-brand' : ''}`}
          >
            <div className="c-rank">{i + 1}</div>
            <div className="c-name">
              <div className="ccr-campaign-name">{r.shortName}</div>
              <div className="ccr-campaign-sub">
                <HostBadge host={r.host} isBrand={r.isBrand} />
              </div>
            </div>
            <div className="c-channel">
              <ChannelPill group={r.channelGroup} />
              <span className="ccr-campaign-chan-sub">{r.channel_name || ''}</span>
            </div>
            <div className="c-spend">
              <b>{fmtCurrency(r.spend)}</b>
              <HBar value={r.spend} max={maxSpend} kind="spend" width={100} />
            </div>
            <div className="c-impr">
              <b>{fmtCompact(r.impressions)}</b>
              <HBar value={r.impressions} max={maxImpr} kind="impr" width={100} />
            </div>
            <div className="c-ctr">
              {r.ctr != null ? <b>{fmtPct(r.ctr)}</b> : <span className="muted">—</span>}
            </div>
            <div className="c-creative">
              <b>{r.creative_count || 0}</b>
              <span className="muted">· {r.publisher_count || 0} pub</span>
            </div>
            <div className="c-dates">
              <span>{r.firstSeenLabel}</span>
              <span className="muted">→ {r.lastSeenLabel}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
