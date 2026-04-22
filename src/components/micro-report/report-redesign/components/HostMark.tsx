/**
 * 2-letter disc for an advertiser. Used inside sidebar rows, benchmark rows,
 * host badges, matrix rows, etc.
 */
type Props = {
  host: string;
  size?: 'sm' | 'md';
  isApp?: boolean;
  className?: string;
};

export function HostMark({ host, size = 'md', isApp = false, className = '' }: Props) {
  const classes = [
    'ccr-host-mark',
    size === 'sm' ? 'sm' : '',
    isApp ? 'is-app' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return <span className={classes}>{(host || '').slice(0, 2).toUpperCase()}</span>;
}

/** Host badge = HostMark + label. `isBrand` highlights in accent. */
export function HostBadge({
  host,
  isBrand = false,
}: {
  host: string;
  isBrand?: boolean;
}) {
  return (
    <span className={`ccr-host-badge ${isBrand ? 'is-brand' : ''}`}>
      <HostMark host={host} />
      <span className="ccr-host-label">{host}</span>
      {isBrand && <span className="ccr-brand-tag">BRAND</span>}
    </span>
  );
}
