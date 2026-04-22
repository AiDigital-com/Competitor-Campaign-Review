import type { ChannelGroup } from './types';

/**
 * Coarse channel groups used across every view. Ordered for visualization.
 * Video > Social > Display > CTV > Other.
 */
export const CH_GROUPS: ChannelGroup[] = ['Video', 'Social', 'Display', 'CTV', 'Other'];

/** HSL hue for each channel group — drives .ccr-chan-dot / .ccr-chan-pill / .ccr-mixbar-seg styling. */
export const CH_HUE: Record<ChannelGroup, number> = {
  Video: 212,
  Social: 295,
  Display: 38,
  CTV: 160,
  Other: 220,
};

/** Normalize a raw channel string from the ad intelligence feed into a coarse group. */
export function coarseChannel(name: string | undefined | null): ChannelGroup {
  if (!name) return 'Other';
  const s = String(name).toLowerCase();
  if (s.includes('connected tv') || s.includes('ctv') || s.includes('smart tv')) return 'CTV';
  if (s.includes('social')) return 'Social';
  if (s.includes('video')) return 'Video';
  if (s.includes('display') || s.includes('banner')) return 'Display';
  return 'Other';
}
