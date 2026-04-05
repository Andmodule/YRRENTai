/**
 * Rubber-band resistance for horizontal swipe (transform-only; px).
 * Lower `k` = heavier pull at the start (anti-accidental / “fluid” feel).
 */
export function rubberBandHorizontal(deltaPx: number, maxPullPx: number, k = 0.38): number {
  if (deltaPx === 0) return 0;
  const sign = deltaPx > 0 ? 1 : -1;
  const x = Math.abs(deltaPx);
  const t = maxPullPx * (1 - Math.exp(-(k * x) / maxPullPx));
  return sign * Math.min(t, maxPullPx);
}

/** Activation: max(100px, 35% of viewport width) — compare to *raw* finger delta, not rubber-banded position. */
export function swipeActivationThresholdPx(): number {
  if (typeof window === 'undefined') return 100;
  return Math.max(100, Math.round(window.innerWidth * 0.35));
}

/** Resting “open delete” width: compact square behind trash (tap target), not a full-width strip. */
export function swipeDeletePeekWidthPx(): number {
  if (typeof window === 'undefined') return 64;
  return Math.max(56, Math.min(72, Math.round(56 + window.innerWidth * 0.02)));
}
