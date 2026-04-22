import { useMemo } from 'react';
import type { CCRData } from '../types';
import { fmtCurrency, fmtCompact } from '../data';
import { CH_GROUPS, CH_HUE } from '../channels';
import { HostBadge } from '../components/HostMark';
import { ChannelDot } from '../components/ChannelPill';
import { ChannelMixBar } from '../components/ChannelMixBar';
import { useLocalStorage } from '../hooks';

type Props = { data: CCRData };
type Metric = 'spend' | 'impressions';

/**
 * V4 — Competitive Matrix. Benchmark rows × channel groups heatmap. Metric
 * toggle switches between spend and impressions. Intensity scales per column.
 */
export function Matrix({ data }: Props) {
  const [metric, setMetric] = useLocalStorage<Metric>('ccr-matrix-metric', 'spend');

  const rows = data.benchmarkRows;
  const cols = CH_GROUPS;
  const metricFmt = metric === 'spend' ? fmtCurrency : fmtCompact;
  const metricKey = metric === 'spend' ? 'spend' : 'impressions';

  const { cellMap, colMax } = useMemo(() => {
    const cells: Record<string, Record<string, { spend: number; impressions: number } | undefined>> = {};
    const maxes: Record<string, number> = {};
    rows.forEach((r) => {
      cells[r.domain] = {};
      r.channelGroups.forEach((g) => {
        cells[r.domain][g.group] = { spend: g.spend || 0, impressions: g.impressions || 0 };
      });
    });
    cols.forEach((g) => {
      maxes[g] = Math.max(
        ...rows.map((r) => cells[r.domain][g]?.[metricKey] || 0),
        1,
      );
    });
    return { cellMap: cells, colMax: maxes };
  }, [rows, cols, metricKey]);

  return (
    <div className="v4-body">
      <header className="ccr-view-head">
        <div className="ccr-view-head-lead">
          <div className="ccr-eyebrow">04 · Competitive Matrix</div>
          <h1 className="ccr-view-title">Where everyone is spending</h1>
          <p className="ccr-view-sub">
            {rows.length} advertisers × {cols.length} channel groups · heatmap by {metric}
          </p>
        </div>
        <div className="ccr-view-head-stats">
          <div className="ccr-stat">
            <label>Brand total</label>
            <b>{fmtCurrency(data.overall.totalBrandSpend)}</b>
          </div>
          <div className="ccr-stat">
            <label>Competitor total</label>
            <b>{fmtCurrency(data.overall.totalCompetitorSpend)}</b>
          </div>
          <div className="ccr-stat">
            <label>Leader</label>
            <b>{rows[0]?.host || '—'}</b>
          </div>
        </div>
      </header>

      <div className="ccr-filterbar slim">
        <div className="ccr-filter-group">
          <label>Metric</label>
          <div className="ccr-seg">
            <button
              className={`ccr-seg-btn ${metric === 'spend' ? 'active' : ''}`}
              onClick={() => setMetric('spend')}
            >
              Spend
            </button>
            <button
              className={`ccr-seg-btn ${metric === 'impressions' ? 'active' : ''}`}
              onClick={() => setMetric('impressions')}
            >
              Impressions
            </button>
          </div>
        </div>
      </div>

      <div className="ccr-matrix" style={{ '--cols': cols.length } as React.CSSProperties}>
        <div className="ccr-matrix-head">
          <div className="cell cell-host">Advertiser</div>
          <div className="cell cell-total">Total</div>
          {cols.map((g) => (
            <div key={g} className="cell cell-col">
              <ChannelDot group={g} />
              <span>{g}</span>
            </div>
          ))}
          <div className="cell cell-mix">Mix</div>
        </div>
        {rows.map((r) => {
          const total = metric === 'spend' ? r.totalSpend : r.totalImpressions;
          return (
            <div key={r.domain} className={`ccr-matrix-row ${r.isBrand ? 'is-brand' : ''}`}>
              <div className="cell cell-host">
                <HostBadge host={r.host} isBrand={r.isBrand} />
                <span className="ccr-matrix-parent">{r.parentCompany || ''}</span>
              </div>
              <div className="cell cell-total">
                <b>{metricFmt(total)}</b>
              </div>
              {cols.map((g) => {
                const cell = cellMap[r.domain][g];
                if (!cell) {
                  return (
                    <div key={g} className="cell cell-num empty">
                      —
                    </div>
                  );
                }
                const val = cell[metricKey];
                const intensity = val ? val / colMax[g] : 0;
                const k = intensity > 0.66 ? 'hot' : intensity > 0.33 ? 'warm' : 'cool';
                return (
                  <div
                    key={g}
                    className={`cell cell-num k-${k}`}
                    style={{ '--intensity': intensity.toFixed(3), '--hue': CH_HUE[g] } as React.CSSProperties}
                  >
                    <b>{metricFmt(val)}</b>
                  </div>
                );
              })}
              <div className="cell cell-mix">
                <ChannelMixBar groups={r.channelGroups} width={160} total={r.totalSpend} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
