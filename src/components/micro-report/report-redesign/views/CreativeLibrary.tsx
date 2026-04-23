import { useMemo } from 'react';
import type { CCRData, ChannelGroup, CreativeType } from '../types';
import { fmtCurrency, fmtCompact } from '../data';
import { CH_GROUPS, CH_HUE } from '../channels';
import { CreativeCard } from '../components/CreativeCard';
import type { LightboxTarget } from '../components/CreativeCard';
import { HostMark } from '../components/HostMark';
import { ChannelDot } from '../components/ChannelPill';
import { useLocalStorage } from '../hooks';

type Props = {
  data: CCRData;
  onOpenVideo: (t: LightboxTarget) => void;
  /** Focus domain chosen from sidebar / benchmark / advertiser row. */
  focusDomain: string;
  onFocusDomainChange: (d: string) => void;
};

type TypeFilter = 'all' | CreativeType;
type ChannelFilter = 'all' | ChannelGroup;
type SortKey = 'spend' | 'impressions' | 'recent';

/**
 * V2 — Creative Library. Gallery + filter bar. This is CCR's hero view.
 * Advertiser, channel, type, sort all persist via localStorage.
 */
export function CreativeLibrary({ data, onOpenVideo, focusDomain, onFocusDomainChange }: Props) {
  const [focusType, setFocusType] = useLocalStorage<TypeFilter>('ccr-focus-type', 'all');
  const [focusChan, setFocusChan] = useLocalStorage<ChannelFilter>('ccr-focus-channel', 'all');
  const [focusSort, setFocusSort] = useLocalStorage<SortKey>('ccr-focus-sort', 'spend');

  const allDomains = useMemo(
    () => [data.brand, ...data.competitors].filter((d): d is NonNullable<typeof d> => d !== null),
    [data],
  );
  const domainObj = allDomains.find((d) => d.domain === focusDomain) || data.brand || allDomains[0];

  const items = useMemo(() => {
    if (!domainObj) return [];
    let list = domainObj.creatives.slice();
    if (focusType !== 'all') list = list.filter((c) => c.type === focusType);
    if (focusChan !== 'all') {
      // A creative belongs to a channel if any of its per-channel slices
      // match. When a channel filter is active, the tile displays ONLY that
      // channel's slice metrics (not the consolidated totals) — otherwise
      // the counts would double-count cross-channel spend.
      list = list
        .filter((c) => (c.channels || []).some((ch) => ch.group === focusChan))
        .map((c) => {
          const slice = (c.channels || []).find((ch) => ch.group === focusChan);
          if (!slice) return c;
          return {
            ...c,
            spend: slice.spend,
            impressions: slice.impressions,
            ctr: slice.ctr,
            channelName: slice.name,
            group: slice.group,
          };
        });
    }
    if (focusSort === 'spend') list.sort((a, b) => (b.spend || 0) - (a.spend || 0));
    else if (focusSort === 'impressions') list.sort((a, b) => (b.impressions || 0) - (a.impressions || 0));
    else if (focusSort === 'recent')
      list.sort((a, b) => String(b.firstSeen || '').localeCompare(String(a.firstSeen || '')));
    return list;
  }, [domainObj, focusType, focusChan, focusSort]);

  const totalSpend = items.reduce((a, c) => a + (c.spend || 0), 0);
  const totalImpr = items.reduce((a, c) => a + (c.impressions || 0), 0);

  // Any-channel membership count — a creative on both Video + Display
  // counts for both groups so the filter chips reflect reality.
  const chanCounts = useMemo(
    () =>
      CH_GROUPS.map((g) => ({
        group: g,
        count: (domainObj?.creatives || []).filter((c) =>
          (c.channels || []).some((ch) => ch.group === g),
        ).length,
        hue: CH_HUE[g],
      })).filter((x) => x.count),
    [domainObj],
  );

  const typeCounts = useMemo(() => {
    const list = domainObj?.creatives || [];
    return {
      video: list.filter((c) => c.type === 'video').length,
      image: list.filter((c) => c.type === 'image').length,
      unknown: list.filter((c) => c.type === 'unknown').length,
    };
  }, [domainObj]);

  if (!domainObj) {
    return (
      <div className="v2-body">
        <p>No creatives available yet.</p>
      </div>
    );
  }

  return (
    <div className="v2-body">
      <header className="ccr-view-head">
        <div className="ccr-view-head-lead">
          <div className="ccr-eyebrow">02 · Creative Library</div>
          <h1 className="ccr-view-title">{domainObj.host} creative</h1>
          <p className="ccr-view-sub">
            {domainObj.parentCompany || ''} · {domainObj.productLine || ''} · {domainObj.creatives.length} creatives tracked
          </p>
        </div>
        <div className="ccr-view-head-stats">
          <div className="ccr-stat">
            <label>Total spend</label>
            <b>{fmtCurrency(totalSpend)}</b>
          </div>
          <div className="ccr-stat">
            <label>Impressions</label>
            <b>{fmtCompact(totalImpr)}</b>
          </div>
          <div className="ccr-stat">
            <label>Showing</label>
            <b>
              {items.length} / {domainObj.creatives.length}
            </b>
          </div>
        </div>
      </header>

      <div className="ccr-filterbar">
        <div className="ccr-filter-group">
          <label>Advertiser</label>
          <div className="ccr-seg">
            {allDomains.map((d) => (
              <button
                key={d.domain}
                className={`ccr-seg-btn ${d.domain === focusDomain ? 'active' : ''} ${
                  d.domain === data.overall.brandDomain ? 'is-brand' : ''
                }`}
                onClick={() => onFocusDomainChange(d.domain)}
              >
                <HostMark host={d.host} size="sm" />
                {d.host}
                <span className="ccr-seg-count">{d.creatives.length}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="ccr-filter-group">
          <label>Channel</label>
          <div className="ccr-seg">
            <button
              className={`ccr-seg-btn ${focusChan === 'all' ? 'active' : ''}`}
              onClick={() => setFocusChan('all')}
            >
              All <span className="ccr-seg-count">{domainObj.creatives.length}</span>
            </button>
            {chanCounts.map((c) => (
              <button
                key={c.group}
                className={`ccr-seg-btn ${focusChan === c.group ? 'active' : ''}`}
                onClick={() => setFocusChan(c.group as ChannelFilter)}
              >
                <ChannelDot group={c.group} />
                {c.group}
                <span className="ccr-seg-count">{c.count}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="ccr-filter-group">
          <label>Type</label>
          <div className="ccr-seg">
            <button
              className={`ccr-seg-btn ${focusType === 'all' ? 'active' : ''}`}
              onClick={() => setFocusType('all')}
            >
              All
            </button>
            <button
              className={`ccr-seg-btn ${focusType === 'video' ? 'active' : ''}`}
              onClick={() => setFocusType('video')}
            >
              Video <span className="ccr-seg-count">{typeCounts.video}</span>
            </button>
            <button
              className={`ccr-seg-btn ${focusType === 'image' ? 'active' : ''}`}
              onClick={() => setFocusType('image')}
            >
              Static <span className="ccr-seg-count">{typeCounts.image}</span>
            </button>
          </div>
        </div>
        <div className="ccr-filter-group">
          <label>Sort</label>
          <div className="ccr-seg">
            <button
              className={`ccr-seg-btn ${focusSort === 'spend' ? 'active' : ''}`}
              onClick={() => setFocusSort('spend')}
            >
              Spend
            </button>
            <button
              className={`ccr-seg-btn ${focusSort === 'impressions' ? 'active' : ''}`}
              onClick={() => setFocusSort('impressions')}
            >
              Impressions
            </button>
            <button
              className={`ccr-seg-btn ${focusSort === 'recent' ? 'active' : ''}`}
              onClick={() => setFocusSort('recent')}
            >
              Recent
            </button>
          </div>
        </div>
      </div>

      <div className="ccr-creative-grid variant-grid">
        {items.map((c) => (
          <CreativeCard
            key={c.id || c.url}
            creative={c}
            isBrand={domainObj.domain === data.overall.brandDomain}
            advertiserHost={domainObj.host}
            showChannelName
            onOpenVideo={onOpenVideo}
          />
        ))}
      </div>
    </div>
  );
}
