import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import {
  Rail,
  ReportTopbar,
  Skeleton,
  ShieldHero,
  ShieldKpiRow,
  ShieldCreativeGrid,
  ShieldCampaignList,
  ShieldMatrix,
  ShieldPublisherList,
  ShieldLandingGrid,
} from '@AiDigital-com/design-system';
import type { CCRData, Variant, Mode, Theme, FX } from './types';

// ReportTopbar's sharing/download configs live in the d.ts but aren't
// re-exported publicly yet. Pick them off the component's own prop shape
// so we stay aligned without depending on unexported type names.
type TopbarProps = ComponentProps<typeof ReportTopbar>;
type ReportTopbarSharingConfig = NonNullable<TopbarProps['sharing']>;
type ReportTopbarDownloadConfig = NonNullable<TopbarProps['download']>;
import { useHtmlAttributes, useLocalStorage, useVariantSweep, useVariantUrlSync } from './hooks';
import { Sidebar } from './components/Sidebar';
import { VideoLightbox } from './components/VideoLightbox';
import type { LightboxTarget } from './components/CreativeCard';
import { Cockpit } from './views/Cockpit';
import { CreativeLibrary } from './views/CreativeLibrary';
import { TopCampaigns } from './views/TopCampaigns';
import { Matrix } from './views/Matrix';
import { PublisherMap } from './views/PublisherMap';
import { LandingPages } from './views/LandingPages';
import { Methodology } from './views/Methodology';

const VARIANT_ORDER: Variant[] = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'method'];

type Props = {
  data: CCRData;
  mode: Mode;
  chip?: string;
  format?: 'visual' | 'markdown';
  onFormatChange?: (f: 'visual' | 'markdown') => void;
  download?: ReportTopbarDownloadConfig;
  onNewSession?: () => void;
  newSessionLabel?: string;
  sharing?: ReportTopbarSharingConfig;
  sharedViewHref?: string;
  printHref?: string;
};

/**
 * Top-level CCR redesign app. Mirrors NM's shell:
 *   rail (parked) · sidebar · main { topbar · 7 variant sections }
 *
 * Variant state persists via localStorage AND mirrors to `?v=<variant>`.
 * Theme + FX also persist. Sidebar advertiser clicks jump to V2 and set
 * `ccr-focus-domain` in localStorage so CreativeLibrary picks it up.
 */
export function App({
  data,
  mode,
  chip,
  format,
  onFormatChange,
  download,
  onNewSession,
  newSessionLabel,
  sharing,
  sharedViewHref,
  printHref,
}: Props) {
  const [variant, setVariant] = useLocalStorage<Variant>('ccr-variant', 'v1');
  const [theme, setTheme] = useLocalStorage<Theme>('ccr-theme', 'dark');
  const [fx] = useLocalStorage<FX>('ccr-fx', 'showcase');
  const [focusDomain, setFocusDomain] = useLocalStorage<string>(
    'ccr-focus-domain',
    data.overall.brandDomain,
  );
  const [lightboxTarget, setLightboxTarget] = useState<LightboxTarget | null>(null);

  useHtmlAttributes(theme, fx);
  useVariantUrlSync(variant, setVariant as (v: string) => void, VARIANT_ORDER);

  // Default the focus domain to the brand when the CCRData swaps to one
  // with a different brand (e.g. switching sessions via share link).
  useEffect(() => {
    const brandDomain = data.overall.brandDomain;
    const allDomains = [data.brand, ...data.competitors]
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .map((d) => d.domain);
    if (!allDomains.includes(focusDomain)) {
      setFocusDomain(brandDomain);
    }
  }, [data.overall.brandDomain, data.brand, data.competitors, focusDomain, setFocusDomain]);

  const { containerRef, sectionRefs, exitingVariant, getSectionSweepClass } = useVariantSweep(
    variant,
    VARIANT_ORDER,
  );

  const handleFocusDomain = useCallback(
    (d: string) => {
      setFocusDomain(d);
      setVariant('v2');
    },
    [setFocusDomain, setVariant],
  );

  // In print mode, render every variant stacked — matches NM/AIO print
  // behavior. Filter state in V2 (CreativeLibrary) is inherited from
  // localStorage; we accept whatever the viewer last set since per-advertiser
  // unroll lives in a follow-up.
  const isActive = (v: Variant) =>
    mode === 'print' ? true : variant === v || exitingVariant === v;

  const brandLabel = data.brand?.parentCompany || data.overall.brandHost || 'Brand';

  // Per-section loading predicates — shields render while Lambdas are still
  // writing to report_data. Empty array / missing brand = not yet landed.
  // Print mode skips shields (we want the full static export to reflect
  // whatever data exists at snapshot time, even if partial).
  const isPrint = mode === 'print';
  const loading = {
    v1: !isPrint && (!data.brand || data.benchmarkRows.length === 0),
    v2: !isPrint && data.allCampaigns.length === 0,
    v3: !isPrint && data.allCampaigns.length === 0,
    v4:
      !isPrint &&
      (data.benchmarkRows.length === 0 || data.allCampaigns.length === 0),
    v5:
      !isPrint &&
      data.publisherList.length === 0 &&
      data.brandPublishers.length === 0,
    v6:
      !isPrint &&
      data.landingPages.length === 0 &&
      data.brandLandingPages.length === 0,
  };

  return (
    <div className="shell">
      <Rail hidden />
      <Sidebar
        data={data}
        variant={variant}
        onNavigate={setVariant}
        onFocusDomain={handleFocusDomain}
        brandLabel={brandLabel}
      />
      <main
        className="report-main"
        ref={(el) => {
          containerRef.current = el;
        }}
      >
        <ReportTopbar
          breadcrumbs={
            <>
              <span>Competitor Campaign Review</span>
              <span>›</span>
              <b>{brandLabel}</b>
            </>
          }
          chip={chip}
          mode={mode}
          theme={theme}
          onThemeToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          format={format}
          onFormatChange={onFormatChange}
          download={download}
          onNewSession={onNewSession}
          newSessionLabel={newSessionLabel}
          sharing={sharing}
          sharedViewHref={sharedViewHref}
          printHref={printHref}
        />

        <section
          className={`variant ${isActive('v1') ? 'active' : ''} ${getSectionSweepClass('v1')}`}
          data-variant="v1"
          ref={(el) => {
            sectionRefs.current.v1 = el;
          }}
        >
          {isActive('v1') && (
            <Skeleton.Show
              when={loading.v1}
              fallback={
                <>
                  <ShieldHero />
                  <ShieldKpiRow n={4} />
                </>
              }
            >
              <Cockpit
                data={data}
                onVariantChange={setVariant}
                onFocusDomain={handleFocusDomain}
                onOpenVideo={setLightboxTarget}
              />
            </Skeleton.Show>
          )}
        </section>

        <section
          className={`variant ${isActive('v2') ? 'active' : ''} ${getSectionSweepClass('v2')}`}
          data-variant="v2"
          ref={(el) => {
            sectionRefs.current.v2 = el;
          }}
        >
          {isActive('v2') && (
            <Skeleton.Show when={loading.v2} fallback={<ShieldCreativeGrid n={8} />}>
              <CreativeLibrary
                data={data}
                onOpenVideo={setLightboxTarget}
                focusDomain={focusDomain}
                onFocusDomainChange={setFocusDomain}
              />
            </Skeleton.Show>
          )}
        </section>

        <section
          className={`variant ${isActive('v3') ? 'active' : ''} ${getSectionSweepClass('v3')}`}
          data-variant="v3"
          ref={(el) => {
            sectionRefs.current.v3 = el;
          }}
        >
          {isActive('v3') && (
            <Skeleton.Show when={loading.v3} fallback={<ShieldCampaignList n={6} />}>
              <TopCampaigns data={data} />
            </Skeleton.Show>
          )}
        </section>

        <section
          className={`variant ${isActive('v4') ? 'active' : ''} ${getSectionSweepClass('v4')}`}
          data-variant="v4"
          ref={(el) => {
            sectionRefs.current.v4 = el;
          }}
        >
          {isActive('v4') && (
            <Skeleton.Show
              when={loading.v4}
              fallback={<ShieldMatrix cols={4} rows={5} />}
            >
              <Matrix data={data} />
            </Skeleton.Show>
          )}
        </section>

        <section
          className={`variant ${isActive('v5') ? 'active' : ''} ${getSectionSweepClass('v5')}`}
          data-variant="v5"
          ref={(el) => {
            sectionRefs.current.v5 = el;
          }}
        >
          {isActive('v5') && (
            <Skeleton.Show when={loading.v5} fallback={<ShieldPublisherList n={8} />}>
              <PublisherMap data={data} />
            </Skeleton.Show>
          )}
        </section>

        <section
          className={`variant ${isActive('v6') ? 'active' : ''} ${getSectionSweepClass('v6')}`}
          data-variant="v6"
          ref={(el) => {
            sectionRefs.current.v6 = el;
          }}
        >
          {isActive('v6') && (
            <Skeleton.Show when={loading.v6} fallback={<ShieldLandingGrid n={6} />}>
              <LandingPages data={data} />
            </Skeleton.Show>
          )}
        </section>

        <section
          className={`variant ${isActive('method') ? 'active' : ''} ${getSectionSweepClass('method')}`}
          data-variant="method"
          ref={(el) => {
            sectionRefs.current.method = el;
          }}
        >
          {isActive('method') && <Methodology data={data} />}
        </section>
      </main>

      <VideoLightbox target={lightboxTarget} onClose={() => setLightboxTarget(null)} />
    </div>
  );
}
