/**
 * «Цены → базовая цена» (pure): a channel's nightly price from the property's base price.
 * The calendar computes the same in the browser (frontend-user/src/modules/pricing/lib/guest-price.ts,
 * `channelPriceFromBase`) — keep the two in step.
 */

/** Lowest / highest channel markup accepted, %. */
export const MARKUP_MIN = -50;
export const MARKUP_MAX = 200;

/** base × (100 + markupPct) / 100, rounded to whole units of the currency (zł, €). */
export function channelPriceFromBase(base: number, markupPct: number | null | undefined): number {
  const pct = Number.isFinite(markupPct) ? (markupPct as number) : 0;
  return Math.round((base * (100 + pct)) / 100);
}

/**
 * What RentAI would set on a channel for each night: the price typed for that night and channel wins;
 * otherwise the base price with the channel markup. Nights with neither are left out.
 */
export function channelTargets(
  dates: readonly string[],
  base: Readonly<Record<string, number>>,
  overrides: Readonly<Record<string, number>>,
  markupPct: number | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of dates) {
    const typed = overrides[d];
    if (typed != null && typed > 0) {
      out.set(d, typed);
      continue;
    }
    const b = base[d];
    if (b != null && b > 0) out.set(d, channelPriceFromBase(b, markupPct));
  }
  return out;
}
