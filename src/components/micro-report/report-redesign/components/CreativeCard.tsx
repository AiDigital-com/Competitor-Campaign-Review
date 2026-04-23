import { useRef, useState } from 'react';
import type { DecoratedCreative } from '../types';
import { CH_HUE } from '../channels';
import { fmtCurrency, fmtCompact } from '../data';
import { ChannelPill } from './ChannelPill';
import { HostBadge } from './HostMark';

export type LightboxTarget = {
  url: string;
  title: string;
  sub: string;
};

type Size = 'md' | 'lg';

function CreativeThumb({ creative, size = 'md' }: { creative: DecoratedCreative; size?: Size }) {
  const hue = CH_HUE[creative.group] ?? 220;
  const seed = String(creative.id || creative.url || '')
    .split('')
    .reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
  const isVideo = creative.type === 'video';
  const isImage = creative.type === 'image';
  const imagePoster = isImage ? (creative.poster || creative.url || null) : creative.poster;
  const [mediaErrored, setMediaErrored] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const showImage = isImage && imagePoster && !mediaErrored;
  const showVideoFrame = isVideo && creative.url && !mediaErrored;
  const hasMedia = showImage || showVideoFrame;

  // Hover-to-play for video thumbs: play muted on enter, pause + reset to
  // first-frame poster on leave. Failures (CORS, autoplay block) silently
  // no-op — the still frame remains visible.
  const handleMouseEnter = () => {
    if (!showVideoFrame) return;
    setIsHovering(true);
    const v = videoRef.current;
    if (!v) return;
    // preload="metadata" only fetched the header; play() forces more buffering.
    const p = v.play();
    if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay denied; keep poster */ });
  };
  const handleMouseLeave = () => {
    if (!showVideoFrame) return;
    setIsHovering(false);
    const v = videoRef.current;
    if (!v) return;
    try {
      v.pause();
      v.currentTime = Math.min(0.1, v.duration || 0.1);
    } catch { /* noop */ }
  };

  return (
    <div
      className={`ccr-thumb size-${size} type-${creative.type} ${hasMedia ? 'has-poster' : 'no-poster'} ${isHovering ? 'is-hovering' : ''}`}
      style={{ '--hue': hue, '--seed': seed } as React.CSSProperties}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="ccr-thumb-gradient" />
      {showImage && (
        <img
          loading="lazy"
          src={imagePoster || ''}
          alt=""
          onError={() => setMediaErrored(true)}
        />
      )}
      {showVideoFrame && (
        // preload="metadata" + no autoplay → browser renders first frame as
        // an implicit poster. muted + playsInline keeps mobile quiet.
        // crossOrigin="anonymous" avoids tainting when AdClarity CDN sets CORS.
        <video
          ref={videoRef}
          className="ccr-thumb-video"
          src={creative.url}
          preload="metadata"
          muted
          playsInline
          crossOrigin="anonymous"
          // Advance one frame so Safari / mobile show a visible poster instead of black
          // (AdClarity MP4s don't embed a poster frame).
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            try { v.currentTime = Math.min(0.1, v.duration || 0.1); } catch { /* noop */ }
          }}
          onError={() => setMediaErrored(true)}
        />
      )}
      <div className="ccr-thumb-overlay" />
      {isVideo && (
        <span className="ccr-thumb-play" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      )}
      <span className={`ccr-thumb-badge type-${creative.type}`}>
        {creative.type === 'video' ? 'VIDEO' : creative.type === 'image' ? 'STATIC' : '—'}
      </span>
    </div>
  );
}

type CardProps = {
  creative: DecoratedCreative;
  isBrand?: boolean;
  advertiserHost?: string;
  size?: Size;
  /** When true, renders the host badge next to the channel pill (V1 cockpit mini-grid). */
  withHost?: boolean;
  showChannelName?: boolean;
  onOpenVideo?: (target: LightboxTarget) => void;
};

export function CreativeCard({
  creative,
  isBrand = false,
  advertiserHost,
  size = 'lg',
  withHost = false,
  showChannelName = false,
  onOpenVideo,
}: CardProps) {
  const isVideo = creative.type === 'video';
  const title = creative.shortName || creative.campaignName || advertiserHost || '';
  const sub = `${advertiserHost || ''} · ${creative.channelName || creative.group || ''}`;

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isVideo) return;
    // Honor modifier keys: Cmd/Ctrl/Shift/Alt/middle-click → open raw URL in new tab
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
    if (!onOpenVideo) return;
    e.preventDefault();
    onOpenVideo({ url: creative.url, title, sub });
  };

  return (
    <a
      className={`ccr-creative-card ${isBrand ? 'is-brand' : ''}`}
      href={creative.url}
      target="_blank"
      rel="noopener"
      title={creative.campaignName || ''}
      onClick={handleClick}
    >
      <CreativeThumb creative={creative} size={size} />
      <div className="ccr-creative-body">
        <div className="ccr-creative-head">
          {withHost && advertiserHost && <HostBadge host={advertiserHost} isBrand={isBrand} />}
          <ChannelPill group={creative.group} />
          {!withHost && (
            <span className={`ccr-creative-type type-${creative.type}`}>
              {creative.type === 'video' ? '▶' : '▦'}
            </span>
          )}
        </div>
        <div className="ccr-creative-campaign">{creative.shortName}</div>
        {showChannelName && creative.channelName && (
          <div className="ccr-creative-channel">{creative.channelName}</div>
        )}
        <div className="ccr-creative-stats">
          <span>
            <b>{fmtCurrency(creative.spend)}</b>
            {withHost ? ' spend' : ''}
          </span>
          <span>{fmtCompact(creative.impressions)} impr</span>
          {withHost && creative.firstSeenLabel && (
            <span className="muted">{creative.firstSeenLabel}</span>
          )}
        </div>
        {!withHost && creative.firstSeenLabel && (
          <div className="ccr-creative-foot">
            <span className="muted">First seen {creative.firstSeenLabel}</span>
          </div>
        )}
      </div>
    </a>
  );
}
