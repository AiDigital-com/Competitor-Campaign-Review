import type { ChannelMixGroup } from '../types';
import { fmtCurrency } from '../data';

/**
 * Horizontal 100%-width channel mix bar — each coloured segment is one
 * channel group, width proportional to spend.
 */
export function ChannelMixBar({
  groups,
  width = 220,
  total = null,
}: {
  groups: ChannelMixGroup[];
  width?: number;
  total?: number | null;
}) {
  const sum = total != null ? total : groups.reduce((a, g) => a + (g.spend || 0), 0);
  if (sum <= 0) {
    return (
      <div className="ccr-mixbar" style={{ width: `${width}px` }}>
        <div className="ccr-mixbar-empty" />
      </div>
    );
  }
  return (
    <div className="ccr-mixbar" style={{ width: `${width}px` }}>
      {groups.map((g) => {
        const pct = ((g.spend || 0) / sum) * 100;
        if (pct <= 0) return null;
        return (
          <div
            key={g.group}
            className="ccr-mixbar-seg"
            style={{ '--hue': g.hue, width: `${pct}%` } as React.CSSProperties}
            title={`${g.group} · ${fmtCurrency(g.spend)} (${pct.toFixed(1)}%)`}
          />
        );
      })}
    </div>
  );
}

/** Small horizontal progress bar — value / max as a pct fill. */
export function HBar({
  value,
  max,
  kind = '',
  width = 120,
}: {
  value: number | null | undefined;
  max: number;
  kind?: string;
  width?: number;
}) {
  const pct = max ? Math.max(2, Math.min(100, ((value || 0) / max) * 100)) : 0;
  return (
    <div className={`ccr-hbar ${kind}`} style={{ width: `${width}px` }}>
      <div className="ccr-hbar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
