import { isYmd, MAX_WINDOW_NIGHTS, nightsBetween, splitWindows } from '../../calendar-dates/calendar-dates.util';

/** Longest calendar overlay read in windows (a month view needs two); longer ones go as one request, as before. */
export const OVERLAY_MAX_WINDOWS = 3;

/**
 * GET /availability windows for the calendar overlay. Zodomus refuses more than one month per request,
 * so a month view (up to 31 nights) is read as ≤ 28-night windows. Short ranges, bad dates and very long
 * ranges stay one request — the old behaviour, and no burst of Zodomus calls for a stray long range.
 */
export function overlayAvailabilityWindows(
  dateFrom: string,
  dateToExclusive: string,
): { dateFrom: string; dateToExclusive: string }[] {
  const single = [{ dateFrom, dateToExclusive }];
  if (!isYmd(dateFrom) || !isYmd(dateToExclusive)) return single;
  const nights = nightsBetween(dateFrom, dateToExclusive);
  if (!(nights > MAX_WINDOW_NIGHTS) || nights > MAX_WINDOW_NIGHTS * OVERLAY_MAX_WINDOWS) return single;
  return splitWindows(dateFrom, dateToExclusive);
}
