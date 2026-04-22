import type { ChannelGroup } from '../types';
import { CH_HUE } from '../channels';

/** Coloured channel pill — dot + label. */
export function ChannelPill({
  group,
  extra,
}: {
  group: ChannelGroup | string;
  extra?: string;
}) {
  const hue = CH_HUE[group as ChannelGroup] ?? 220;
  return (
    <span className="ccr-chan-pill" style={{ '--hue': hue } as React.CSSProperties}>
      <span className="ccr-chan-dot" style={{ '--hue': hue } as React.CSSProperties} />
      {group}
      {extra ? <span className="ccr-chan-extra">{extra}</span> : null}
    </span>
  );
}

/** Bare channel dot (used as a legend marker). */
export function ChannelDot({ group, size = 10 }: { group: ChannelGroup | string; size?: number }) {
  const hue = CH_HUE[group as ChannelGroup] ?? 220;
  return (
    <span
      className="ccr-chan-dot"
      style={{ '--hue': hue, width: `${size}px`, height: `${size}px` } as React.CSSProperties}
      title={String(group)}
    />
  );
}
