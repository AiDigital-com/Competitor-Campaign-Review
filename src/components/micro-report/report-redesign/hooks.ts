import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVariantSweep as useDSVariantSweep } from '@AiDigital-com/design-system';

/**
 * useLocalStorage — sync a piece of state with localStorage.
 * Default value is returned when the key is missing or malformed.
 */
export function useLocalStorage<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* quota / private mode — swallow */
        }
        return next;
      });
    },
    [key],
  );

  return [value, set];
}

/** Apply [data-theme] and [data-fx] to the <html> element whenever they change. */
export function useHtmlAttributes(theme: 'dark' | 'light', fx: 'default' | 'neuro' | 'showcase') {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.setAttribute('data-fx', fx);
  }, [fx]);
}

/**
 * useVariantSweep — CCR-local shell around the DS `useVariantSweep` hook.
 *
 * Mirrors NM's local hook: the DS hook owns the container-level scan-line
 * overlay; this shell adds section refs + exit-window state so the outgoing
 * variant section stays mounted + `.active` for the 780ms transition.
 * Only runs when `data-fx="showcase"` — no-op otherwise.
 */
interface SweepState {
  exitingVariant: string | null;
  direction: 'left' | 'right' | null;
}

export function useVariantSweep(variant: string, order: readonly string[]) {
  const containerRef = useRef<HTMLElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const prevRef = useRef(variant);
  const [sweep, setSweep] = useState<SweepState>({ exitingVariant: null, direction: null });

  const { runScan } = useDSVariantSweep({ order, duration: 780 });

  useEffect(() => {
    const prev = prevRef.current;
    if (prev === variant) return;
    prevRef.current = variant;
    if (typeof document === 'undefined') return;
    if (document.documentElement.getAttribute('data-fx') !== 'showcase') return;
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (mq?.matches) return;

    const container = containerRef.current;
    if (!container) return;

    const dir: 'left' | 'right' =
      order.indexOf(variant) > order.indexOf(prev) ? 'right' : 'left';

    setSweep({ exitingVariant: prev, direction: dir });
    container.scrollTo({ top: 0, behavior: 'instant' });
    runScan(dir, container);

    const cleanup = window.setTimeout(() => {
      setSweep({ exitingVariant: null, direction: null });
    }, 780);
    return () => window.clearTimeout(cleanup);
  }, [variant, order, runScan]);

  const playSweep = useCallback(
    (direction: 'left' | 'right') => {
      if (typeof document === 'undefined') return;
      if (document.documentElement.getAttribute('data-fx') !== 'showcase') return;
      runScan(direction, containerRef.current);
    },
    [runScan],
  );

  const getSectionSweepClass = useCallback(
    (v: string): string => {
      if (!sweep.direction) return '';
      if (v === sweep.exitingVariant) {
        return sweep.direction === 'right'
          ? 'aidl-sweep-exit-left'
          : 'aidl-sweep-exit-right';
      }
      if (v === variant) {
        return sweep.direction === 'right'
          ? 'aidl-sweep-enter-from-right'
          : 'aidl-sweep-enter-from-left';
      }
      return '';
    },
    [sweep, variant],
  );

  return useMemo(
    () => ({
      containerRef,
      sectionRefs,
      exitingVariant: sweep.exitingVariant,
      getSectionSweepClass,
      playSweep,
    }),
    [sweep, getSectionSweepClass, playSweep],
  );
}

/** Read ?v=<variant> on mount; write it back when the variant changes. */
export function useVariantUrlSync(
  variant: string,
  setVariant: (v: string) => void,
  validVariants: readonly string[],
) {
  // On mount, pick up ?v=
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const v = params.get('v');
    if (v && validVariants.includes(v) && v !== variant) {
      setVariant(v);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On variant change, mirror into the URL (replace, don't push)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('v') === variant) return;
    params.set('v', variant);
    const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState({}, '', newUrl);
  }, [variant]);
}
