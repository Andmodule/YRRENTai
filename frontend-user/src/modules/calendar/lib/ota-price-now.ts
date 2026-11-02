import { addDays, format, parseISO } from 'date-fns';

/** «Цена на канале»: what Booking's Standard rate is now on the picked nights (from the calendar's channel read). */
export type ChannelPriceNow = {
  /** Lowest and highest known nightly price; null when no night of the range has one. */
  min: number | null;
  max: number | null;
  /** Nights of the range without a known channel price. */
  unknown: number;
  nights: number;
};

/** `dateToExclusive` is the day after the last night, like push-rates. */
export function channelPriceNow(
  prices: Readonly<Record<string, number>> | undefined,
  dateFrom: string,
  dateToExclusive: string,
): ChannelPriceNow {
  const out: ChannelPriceNow = { min: null, max: null, unknown: 0, nights: 0 };
  if (!dateFrom || !dateToExclusive || dateFrom >= dateToExclusive) return out;
  let cur = dateFrom;
  // A year of nights at most: a mistyped year must not spin the loop.
  while (cur < dateToExclusive && out.nights < 366) {
    out.nights++;
    const p = prices?.[cur];
    if (p != null && p > 0) {
      out.min = out.min == null ? p : Math.min(out.min, p);
      out.max = out.max == null ? p : Math.max(out.max, p);
    } else {
      out.unknown++;
    }
    cur = format(addDays(parseISO(`${cur}T12:00:00`), 1), 'yyyy-MM-dd');
  }
  return out;
}
