import { useMemo } from 'react';
import {
  Shield,
  Skeleton,
  ShieldCreativeGrid,
} from '@AiDigital-com/design-system';
import type { CCRData, Variant } from '../types';
import {
  fmtCurrency,
  fmtCompact,
  fmtPct,
  computeBlendedCtr,
} from '../data';
import { heroCopy } from '../copy';
import { HostBadge } from '../components/HostMark';
import { ChannelDot } from '../components/ChannelPill';
import { ChannelMixBar, HBar } from '../components/ChannelMixBar';
import { CreativeCard } from '../components/CreativeCard';
import type { LightboxTarget } from '../components/CreativeCard';
import { CH_GROUPS, CH_HUE } from '../channels';

type Props = {
  data: CCRData;
  onVariantChange: (v: Variant) => void;
  onFocusDomain: (domain: string) => void;
  onOpenVideo: (t: LightboxTarget) => void;
};

/** Allow <b> only in the exec-summary HTML. */
function sanitizeBold(s: string): string {
  if (!s) return '';
  return s.replace(/<(?!\/?b>)[^>]*>/gi, '');
}

/**
 * V1 — Cockpit. The single-screen executive answer: exec summary + brand KPIs
 * + blended CTR funnel + benchmark mini-table + top creatives in market +
 * worth-studying competitor campaign card.
 */
export function Cockpit({ data, onVariantChange, onFocusDomain, onOpenVideo }: Props) {
  const brand = data.brand;
  const brandRow = data.benchmarkRows.find((r) => r.isBrand);
  const leader = data.benchmarkRows[0];
  const brandRank = data.overall.brandRank;
  const numInSet = data.benchmarkRows.length;

  // Top 6 creatives by spend (across brand + competitors)
  const topCreativesAll = useMemo(() => {
    const all = [data.brand, ...data.competitors]
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .flatMap((d) =>
        d.creatives.map((c) => ({
          creative: c,
          host: d.host,
          isBrand: d.domain === data.overall.brandDomain,
        })),
      );
    all.sort((a, b) => (b.creative.spend || 0) - (a.creative.spend || 0));
    return all.slice(0, 6);
  }, [data]);

  const learnCampaign = data.competitorCampaigns[0];

  const { ctr: weightedCtr, clicks, clickedImpressions } = useMemo(
    () => computeBlendedCtr(data.brandCampaigns),
    [data.brandCampaigns],
  );
  const ctrCoveragePct = brand?.totalImpressions ? (clickedImpressions / brand.totalImpressions) * 100 : 0;
  const firstSeen = useMemo(
    () => data.brandCampaigns.map((c) => c.first_seen).filter(Boolean).sort()[0],
    [data.brandCampaigns],
  );
  const lastSeen = useMemo(
    () => data.brandCampaigns.map((c) => c.last_seen).filter(Boolean).sort().reverse()[0],
    [data.brandCampaigns],
  );
  const daysRun =
    firstSeen && lastSeen
      ? Math.max(1, Math.round((new Date(lastSeen).getTime() - new Date(firstSeen).getTime()) / 86_400_000))
      : null;

  const brandMix = brand?.channelGroups || [];
  const topChan = [...brandMix].sort((a, b) => (b.spend || 0) - (a.spend || 0))[0];
  const brandMixSpendSum = brandMix.reduce((a, g) => a + (g.spend || 0), 0);
  const topChanShare = topChan && brandMixSpendSum > 0 ? (topChan.spend / brandMixSpendSum) * 100 : 0;

  const secondBrand = data.benchmarkRows.filter((r) => !r.isBrand)[0];
  const nVideo = brand?.creativesByType?.video || 0;
  const brandCreatives = brand?.creatives || [];
  const vidShare = brandCreatives.length ? (nVideo / brandCreatives.length) * 100 : 0;

  const execSummary = useMemo(() => {
    const parts: string[] = [];
    if (brandRank === 1 && secondBrand && brand) {
      parts.push(
        heroCopy.leaderVerdict(
          brand.host,
          fmtCurrency(brand.totalSpend),
          `${(brandRow?.sovSpend || 0).toFixed(0)}%`,
          fmtCurrency((brand.totalSpend || 0) - (secondBrand.totalSpend || 0)),
          secondBrand.host || '—',
        ),
      );
    } else if (brand && leader) {
      parts.push(
        heroCopy.rankVerdict(
          brand.host,
          brandRank || 0,
          numInSet,
          fmtCurrency(brand.totalSpend),
          `${(brandRow?.sovSpend || 0).toFixed(0)}%`,
          fmtCurrency(leader.totalSpend - (brand.totalSpend || 0)),
          leader.host,
        ),
      );
    }
    if (topChan) {
      parts.push(heroCopy.channelSplit(topChan.group, `${topChanShare.toFixed(0)}%`, brandMix.length - 1));
    }
    if (weightedCtr != null) {
      parts.push(
        heroCopy.blendedCtr(
          `${weightedCtr.toFixed(2)}%`,
          fmtCompact(Math.round(clicks)),
          fmtCompact(clickedImpressions),
        ),
      );
    }
    parts.push(heroCopy.creativeWindow(brandCreatives.length, `${vidShare.toFixed(0)}%`, daysRun));
    return parts.join(' ');
  }, [
    brand,
    brandRank,
    brandRow,
    brandMix.length,
    brandCreatives.length,
    leader,
    numInSet,
    secondBrand,
    topChan,
    topChanShare,
    vidShare,
    weightedCtr,
    clicks,
    clickedImpressions,
    daysRun,
  ]);

  if (!brand) {
    return (
      <div className="v1-body">
        <p>No brand data available yet.</p>
      </div>
    );
  }

  // ── Per-slice loading predicates ──────────────────────────────────────────
  // Each block lights up the moment its own Lambda has written, independent
  // of the others. The header strip is always visible once `brand` lands.
  const benchmarkReady = data.benchmarkRows.length > 0;
  const creativesReady = (brand.creatives?.length || 0) > 0;
  const campaignsReady = data.brandCampaigns.length > 0;
  const topCreativesReady = topCreativesAll.length > 0;
  // Exec summary is the synthesis — only read it as "done" when its heaviest
  // inputs are all in. Until then, a 3-line shimmer stands in for the prose.
  const execReady = benchmarkReady && campaignsReady && creativesReady;

  return (
    <div className="v1-body">
      <header className="ccr-hero">
        <div className="ccr-hero-lead">
          <div className="ccr-eyebrow">Cockpit · Cross-Channel Creative Review</div>
          <h1 className="ccr-hero-title">{brand.host}</h1>
          <p className="ccr-hero-sub">
            {brand.productLine || ''} · {brand.parentCompany || ''} · Scanned {data.overall.scanDateLabel}
          </p>

          {execReady ? (
            <div
              className="ccr-nudge ccr-exec-summary"
              dangerouslySetInnerHTML={{ __html: sanitizeBold(execSummary) }}
            />
          ) : (
            <div className="ccr-nudge ccr-exec-summary">
              <Skeleton.Text lines={3} lastWidth="55%" />
            </div>
          )}

          <div className="ccr-hero-kpis">
            <div className="ccr-kpi">
              <div className="ccr-kpi-label">Measured spend</div>
              <div className="ccr-kpi-value">
                {brand.totalSpend != null ? (
                  fmtCurrency(brand.totalSpend)
                ) : (
                  <Shield as="line" w="70%" h={22} />
                )}
              </div>
              <div className="ccr-kpi-sub">
                {benchmarkReady ? (
                  `${(brandRow?.sovSpend || 0).toFixed(0)}% share of set`
                ) : (
                  <Shield as="line" w="55%" h={10} />
                )}
              </div>
            </div>
            <div className="ccr-kpi">
              <div className="ccr-kpi-label">Impressions</div>
              <div className="ccr-kpi-value">
                {brand.totalImpressions != null ? (
                  fmtCompact(brand.totalImpressions)
                ) : (
                  <Shield as="line" w="60%" h={22} />
                )}
              </div>
              <div className="ccr-kpi-sub">
                {benchmarkReady ? (
                  `${(brandRow?.sovImpr || 0).toFixed(0)}% share of set`
                ) : (
                  <Shield as="line" w="55%" h={10} />
                )}
              </div>
            </div>
            <div className="ccr-kpi">
              <div className="ccr-kpi-label">Active creatives</div>
              <div className="ccr-kpi-value">
                {creativesReady ? (
                  brand.creatives.length
                ) : (
                  <Shield as="line" w="30%" h={22} />
                )}
              </div>
              <div className="ccr-kpi-sub">
                {creativesReady ? (
                  <>{brand.creativesByType.video} video · {brand.creativesByType.image} static</>
                ) : (
                  <Shield as="line" w="65%" h={10} />
                )}
              </div>
            </div>
            <div className="ccr-kpi">
              <div className="ccr-kpi-label">Rank in set</div>
              <div className="ccr-kpi-value">
                {benchmarkReady ? (
                  <>
                    <span className="ccr-kpi-rank">#{brandRank || '—'}</span>
                    <span className="ccr-kpi-rank-of">/ {numInSet}</span>
                  </>
                ) : (
                  <Shield as="line" w="45%" h={22} />
                )}
              </div>
              <div className="ccr-kpi-sub">
                {benchmarkReady ? (
                  `${numInSet - 1} competitors tracked`
                ) : (
                  <Shield as="line" w="60%" h={10} />
                )}
              </div>
            </div>
          </div>
        </div>

        <aside className="ccr-hero-side">
          <div className="ccr-eyebrow">Performance</div>
          <div className="ccr-vfunnel">
            <div className="ccr-vfunnel-step">
              <div className="ccr-vfunnel-label">Impressions</div>
              <div className="ccr-vfunnel-value">
                {brand.totalImpressions != null ? (
                  fmtCompact(brand.totalImpressions)
                ) : (
                  <Shield as="line" w="65%" h={20} />
                )}
              </div>
            </div>
            <div className="ccr-vfunnel-step">
              <div className="ccr-vfunnel-label">
                Clicks <span className="ccr-funnel-tag">est.</span>
              </div>
              <div className="ccr-vfunnel-value">
                {campaignsReady ? (
                  fmtCompact(Math.round(clicks))
                ) : (
                  <Shield as="line" w="55%" h={20} />
                )}
              </div>
            </div>
            <div className="ccr-vfunnel-step is-hl">
              <div className="ccr-vfunnel-label">Blended CTR</div>
              <div className="ccr-vfunnel-value ccr-funnel-value--hl">
                {campaignsReady && weightedCtr != null ? (
                  `${weightedCtr.toFixed(2)}%`
                ) : (
                  <Shield as="line" w="45%" h={20} />
                )}
              </div>
            </div>
          </div>
          <div className="ccr-vfunnel-note">
            {campaignsReady ? (
              <>
                <span>
                  {data.brandCampaigns.length} campaign{data.brandCampaigns.length === 1 ? '' : 's'}
                </span>
                <span className="sep">·</span>
                <span>{ctrCoveragePct.toFixed(0)}% measurable</span>
                {daysRun != null && (
                  <>
                    <span className="sep">·</span>
                    <span>{daysRun}d in-market</span>
                  </>
                )}
              </>
            ) : (
              <Shield as="line" w="80%" h={10} />
            )}
          </div>
        </aside>
      </header>

      <section className="ccr-section">
        <div className="ccr-section-head">
          <h2>Benchmark set</h2>
          <div className="ccr-section-sub">
            {benchmarkReady ? (
              `${data.benchmarkRows.length} advertisers · ranked by measured spend`
            ) : (
              <Shield as="line" w="55%" h={10} />
            )}
          </div>
        </div>
        <div className="ccr-benchmark-mini">
          <div className="ccr-benchmark-head">
            <div className="ccr-benchmark-rank">#</div>
            <div className="ccr-benchmark-id">Advertiser</div>
            <div className="ccr-benchmark-spend">Measured spend</div>
            <div className="ccr-benchmark-mix">
              <span>Channel mix</span>
              <span className="ccr-benchmark-legend">
                {CH_GROUPS.map((g) => (
                  <span
                    key={g}
                    className="ccr-benchmark-legend-item"
                    style={{ '--hue': CH_HUE[g] } as React.CSSProperties}
                  >
                    <ChannelDot group={g} size={6} />
                    {g}
                  </span>
                ))}
              </span>
            </div>
            <div className="ccr-benchmark-impr">Impressions</div>
            <div className="ccr-benchmark-sov">SOV</div>
          </div>
          {!benchmarkReady &&
            Array.from({ length: 4 }).map((_, i) => (
              <div key={`sh-${i}`} className="ccr-benchmark-row">
                <div className="ccr-benchmark-rank">
                  <Shield as="line" w={16} h={10} />
                </div>
                <div className="ccr-benchmark-id">
                  <Shield as="circle" size={24} />
                  <Shield as="line" w="60%" h={10} />
                </div>
                <div className="ccr-benchmark-spend">
                  <Shield as="line" w="70%" h={12} />
                </div>
                <div className="ccr-benchmark-mix">
                  <Shield as="line" w="90%" h={12} />
                </div>
                <div className="ccr-benchmark-impr">
                  <Shield as="line" w="65%" h={10} />
                </div>
                <div className="ccr-benchmark-sov">
                  <Shield as="line" w="40%" h={10} />
                </div>
              </div>
            ))}
          {data.benchmarkRows.map((r, i) => (
            <div
              key={r.domain}
              className={`ccr-benchmark-row ${r.isBrand ? 'is-brand' : ''}`}
              onClick={() => onFocusDomain(r.domain)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onFocusDomain(r.domain);
              }}
            >
              <div className="ccr-benchmark-rank">{i + 1}</div>
              <div className="ccr-benchmark-id">
                <HostBadge host={r.host} isBrand={r.isBrand} />
                <span className="ccr-benchmark-parent">{r.parentCompany || ''}</span>
              </div>
              <div className="ccr-benchmark-spend">
                <b>{fmtCurrency(r.totalSpend)}</b>
                <HBar value={r.totalSpend} max={data.maxBenchmarkSpend} kind="spend" width={140} />
              </div>
              <div className="ccr-benchmark-mix">
                <ChannelMixBar groups={r.channelGroups} width={220} />
              </div>
              <div className="ccr-benchmark-impr">{fmtCompact(r.totalImpressions)}</div>
              <div className="ccr-benchmark-sov">{(r.sovSpend || 0).toFixed(0)}%</div>
            </div>
          ))}
        </div>
      </section>

      <section className="ccr-section">
        <div className="ccr-section-head">
          <h2>Top creatives in the market</h2>
          <div className="ccr-section-sub">Ranked by measured spend · brand + competitors</div>
          <button className="ccr-section-cta" onClick={() => onVariantChange('v2')}>
            Open creative library →
          </button>
        </div>
        {topCreativesReady ? (
          <div className="ccr-creative-grid cockpit-mini">
            {topCreativesAll.map((item) => (
              <CreativeCard
                key={`${item.host}-${item.creative.id || item.creative.url}`}
                creative={item.creative}
                isBrand={item.isBrand}
                advertiserHost={item.host}
                withHost
                size="lg"
                onOpenVideo={onOpenVideo}
              />
            ))}
          </div>
        ) : (
          <ShieldCreativeGrid n={6} />
        )}
      </section>

      {learnCampaign && (
        <section className="ccr-section ccr-learn">
          <div className="ccr-learn-card">
            <div className="ccr-eyebrow">Worth studying</div>
            <div className="ccr-learn-title">{learnCampaign.shortName}</div>
            <div className="ccr-learn-host">
              <HostBadge host={learnCampaign.host} />
            </div>
            <p className="ccr-learn-body">
              This {learnCampaign.channel_name || ''} campaign from {learnCampaign.host} drove{' '}
              <b>{fmtCompact(learnCampaign.impressions)}</b> impressions on{' '}
              <b>{fmtCurrency(learnCampaign.spend)}</b> across <b>{learnCampaign.creative_count || 0}</b>{' '}
              creative variant{learnCampaign.creative_count === 1 ? '' : 's'}
              {learnCampaign.ctr != null && (
                <>
                  {' '}— <b>{fmtPct(learnCampaign.ctr)}</b> CTR
                </>
              )}
              . Published {learnCampaign.firstSeenLabel}, last seen {learnCampaign.lastSeenLabel}.
            </p>
            <div className="ccr-learn-actions">
              <button className="btn btn-primary" onClick={() => onVariantChange('v3')}>
                Browse all campaigns →
              </button>
              <button className="btn" onClick={() => onVariantChange('v2')}>
                See creatives
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
