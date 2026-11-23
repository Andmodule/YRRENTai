/**
 * «Скидка» (pure): the channel price of a night goes down by the biggest discount covering it on that channel.
 * The calendar computes the same in the browser (frontend-user/src/modules/pricing/lib/guest-price.ts,
 * `discountedPrice`) — keep the two in step.
 */

export const DISCOUNT_CHANNELS = ['booking', 'airbnb'] as const;
export type DiscountChannel = (typeof DISCOUNT_CHANNELS)[number];
export const DISCOUNT_PCT_MIN = 1;
export const DISCOUNT_PCT_MAX = 90;

export type DiscountSpan = {
  dateFrom: string;
  /** Inclusive. */
  dateTo: string;
  pct: number;
  channels: readonly string[];
};

/**
 * Night → percent of the biggest discount on `channel`, for the nights of [from, to] (inclusive) that a
 * discount covers. Discounts never add up: −10 % and −15 % on one night give −15 %.
 */
export function discountPctByNight(
  spans: readonly DiscountSpan[],
  channel: DiscountChannel,
  from: string,
  to: string,
  addDays: (ymd: string, n: number) => string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of spans) {
    if (!s.channels.includes(channel) || !(s.pct > 0)) continue;
    const start = s.dateFrom > from ? s.dateFrom : from;
    const end = s.dateTo < to ? s.dateTo : to;
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if ((out.get(d) ?? 0) < s.pct) out.set(d, s.pct);
    }
  }
  return out;
}

/** The price lowered by `pct`, in whole units of the currency (zł, €). */
export function discountedPrice(price: number, pct: number): number {
  if (!(pct > 0)) return price;
  return Math.round((price * (100 - pct)) / 100);
}

/**
 * Lowers every night of `targets` that has a discount, in place; never below the minimum price — such nights
 * get the minimum and are returned, so the person is told instead of the price silently stopping there.
 */
export function applyDiscounts(
  targets: Map<string, number>,
  pcts: ReadonlyMap<string, number>,
  minPrice: number | null,
): string[] {
  const atMin: string[] = [];
  for (const [date, pct] of pcts) {
    const price = targets.get(date);
    if (price == null || !(price > 0)) continue;
    const lowered = discountedPrice(price, pct);
    if (minPrice != null && minPrice > 0 && lowered < minPrice) {
      // Already under the minimum before the discount: left as it was (the send skips such nights anyway) and not
      // reported — the discount did not stop there, the night was under the minimum already.
      if (price < minPrice) continue;
      targets.set(date, minPrice);
      atMin.push(date);
    } else {
      targets.set(date, lowered);
    }
  }
  return atMin.sort();
}
