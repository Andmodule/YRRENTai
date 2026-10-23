import { addDaysYmd, isYmd, MAX_WINDOW_NIGHTS, nightsBetween, splitWindows } from '../../calendar-dates/calendar-dates.util';

/**
 * Booking does not serve nights that are long gone: a GET /availability window that starts weeks in the
 * past fails, and with it the whole channel (the calendar of one property showed «Booking не ответил» for
 * the current month, which starts on the 1st). The overlay is read from yesterday on — where the main
 * calendar starts anyway; earlier nights simply get no channel data.
 *
 * Checked on production 2026-10-23 (K22 Andersa): a window from yesterday answers, from the day before
 * yesterday or a week back the channel fails. So 1 is the limit, not a guess — 2 would break every read.
 * Keep it ≥ the main calendar's past days (frontend `CALENDAR_WINDOW_PAST_DAYS`, TimelineNavBar.tsx).
 * «Yesterday» is in the property time zone; a browser a time zone behind may show one past night more,
 * which then simply has no channel data.
 */
export const OVERLAY_PAST_DAYS = 1;

/** First night to ask Zodomus for: `dateFrom`, but not before `today` − OVERLAY_PAST_DAYS (property time zone). */
export function overlayReadStart(dateFrom: string, today: string): string {
  if (!isYmd(dateFrom) || !isYmd(today)) return dateFrom;
  const earliest = addDaysYmd(today, -OVERLAY_PAST_DAYS);
  return dateFrom < earliest ? earliest : dateFrom;
}

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
