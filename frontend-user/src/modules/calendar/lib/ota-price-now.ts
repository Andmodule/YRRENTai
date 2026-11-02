import { addDays, format, isValid, parseISO } from 'date-fns';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isYmd = (s: string) => YMD.test(s) && isValid(parseISO(`${s}T12:00:00`));

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
  // A date input lets a 5-digit year through; such a date is not a night to look up.
  if (!isYmd(dateFrom) || !isYmd(dateToExclusive) || dateFrom >= dateToExclusive) return out;
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
