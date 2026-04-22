import { useState } from 'react';
import type { CCRData, DecoratedLandingPage } from '../types';
import { HostBadge } from '../components/HostMark';

type Props = { data: CCRData };

function LandingShot({ lp }: { lp: DecoratedLandingPage }) {
  const [errored, setErrored] = useState(false);
  const hasShot = !!lp.screenshotUrl && !errored;
  return (
    <div className={`ccr-landing-shot ${hasShot ? '' : 'no-shot'}`}>
      {hasShot && (
        <img
          loading="lazy"
          src={lp.screenshotUrl || ''}
          alt={lp.title || ''}
          onError={() => setErrored(true)}
        />
      )}
      <div className="ccr-landing-shot-overlay" />
    </div>
  );
}

/**
 * V6 — Landing Pages. Screenshot grid + metadata for every captured landing
 * page. Firecrawl-extracted titles + descriptions when available.
 */
export function LandingPages({ data }: Props) {
  return (
    <div className="v6-body">
      <header className="ccr-view-head">
        <div className="ccr-view-head-lead">
          <div className="ccr-eyebrow">06 · Landing Pages</div>
          <h1 className="ccr-view-title">Where the creatives point</h1>
          <p className="ccr-view-sub">{data.landingPages.length} pages captured · preview + domain</p>
        </div>
      </header>

      <div className="ccr-landing-grid">
        {data.landingPages.map((lp, i) => (
          <a
            key={`${lp.url}-${i}`}
            className={`ccr-landing-card ${lp.isBrand ? 'is-brand' : ''}`}
            href={lp.url}
            target="_blank"
            rel="noopener"
          >
            <LandingShot lp={lp} />
            <div className="ccr-landing-body">
              <div className="ccr-landing-head">
                <HostBadge host={lp.host} isBrand={lp.isBrand} />
              </div>
              <div className="ccr-landing-title">{lp.shortTitle || lp.title || 'Landing page'}</div>
              {lp.shortCampaign && <div className="ccr-landing-campaign">{lp.shortCampaign}</div>}
              {lp.description && <div className="ccr-landing-desc">{lp.description}</div>}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
