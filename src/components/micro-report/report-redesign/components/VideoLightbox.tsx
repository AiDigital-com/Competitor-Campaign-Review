import { useEffect, useRef, useState } from 'react';
import type { LightboxTarget } from './CreativeCard';

type Props = {
  target: LightboxTarget | null;
  onClose: () => void;
};

/**
 * Video lightbox — inline MP4 playback over the report with a CORS-safe
 * fallback. If the video fails to load (CORS, 404, codec mismatch), we show
 * a message + "Open video ↗" button that opens the raw URL in a new tab.
 *
 * Keyboard:  Esc closes · Space / k toggles play · m toggles mute
 * Escape hatch: Cmd/Ctrl-click on the creative card (handled by CreativeCard)
 *   bypasses the lightbox and opens the raw URL in a new tab.
 */
export function VideoLightbox({ target, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const isOpen = target !== null;

  // Lock body scroll + remember previously-focused element
  useEffect(() => {
    if (!isOpen) return;
    lastFocusRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      lastFocusRef.current?.focus?.();
    };
  }, [isOpen]);

  // Keyboard controls
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) v.play().catch(() => undefined);
        else v.pause();
      } else if (e.key === 'm') {
        const v = videoRef.current;
        if (!v) return;
        v.muted = !v.muted;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Reset load state when target changes + nudge autoplay
  useEffect(() => {
    setLoadFailed(false);
    if (!target) return;
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    const p = v.play();
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
  }, [target]);

  if (!target) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-vbox-close]')) onClose();
  };

  return (
    <div
      className="ccr-vbox-overlay is-open"
      role="dialog"
      aria-modal="true"
      aria-label="Video playback"
      onClick={handleBackdropClick}
    >
      <div className="ccr-vbox-backdrop" data-vbox-close />
      <div className="ccr-vbox-window">
        <header className="ccr-vbox-head">
          <div className="ccr-vbox-meta">
            <div className="ccr-vbox-title">{target.title || 'Video'}</div>
            <div className="ccr-vbox-sub">{target.sub}</div>
          </div>
          <div className="ccr-vbox-actions">
            <a
              className="ccr-vbox-open"
              href={target.url}
              target="_blank"
              rel="noopener"
              title="Open source in new tab"
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
              </svg>
              <span>Source</span>
            </a>
            <button
              className="ccr-vbox-close"
              type="button"
              data-vbox-close
              aria-label="Close"
              onClick={onClose}
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </header>
        <div className="ccr-vbox-stage">
          {loadFailed ? (
            <div className="ccr-vbox-fallback">
              <p>Inline playback is blocked for this asset (likely CORS).</p>
              <a className="ccr-vbox-open" href={target.url} target="_blank" rel="noopener">
                Open video ↗
              </a>
            </div>
          ) : (
            <video
              ref={videoRef}
              className="ccr-vbox-video"
              controls
              playsInline
              preload="metadata"
              src={target.url}
              onError={() => setLoadFailed(true)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
