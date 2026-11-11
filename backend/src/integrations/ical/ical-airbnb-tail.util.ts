/**
 * Airbnb's iCal export closes everything after the listing's booking window («Свободные даты» → how far ahead
 * guests may book: 3, 6, 9 or 12 months) with one event «Airbnb (Not available)» from today + window to about a
 * year ahead. It is not a booking: imported, it would block those months in RentAI and then close them on Booking
 * too. It is told from a real closure by where it starts — exactly at today + window, moving one day forward
 * every day; a host's own closure starts on a fixed date. Seen 2026-11-11 on all K22 listings: 09.02.2027
 * (today + 90 days) to 12.11.2027.
 */

/** Exactly Airbnb's own summary for unavailable dates (not Booking's «CLOSED - Not available»). */
const AIRBNB_NOT_AVAILABLE = /^\s*airbnb\s*\(\s*not available\s*\)\s*$/i;

/** Airbnb's booking windows, in days from today. */
export const AIRBNB_WINDOW_DAYS: readonly number[] = [90, 180, 270, 365];

/** The tail of a feed read now starts within this many days of today + window (time zones, a late read). */
export const AIRBNB_TAIL_FEED_TOLERANCE_DAYS = 2;

/**
 * A tail imported before (its start was today + window on the day it was read, so it is a little earlier now)
 * is recognised up to this many days late — enough to cover the days until this rule is deployed, short so a
 * host's own long closure is not taken for a tail. A tail still in the feed is matched by its uid instead.
 */
export const AIRBNB_TAIL_STORED_TOLERANCE_DAYS = 7;

/**
 * The tail ends where Airbnb's feed ends: about a year ahead (seen 2026-11-11: 12.11.2027, today + 366). A host's
 * closure that ends elsewhere is never a tail, even if its start happens to fall on a window edge.
 */
export const AIRBNB_TAIL_END_DAYS_MIN = 362;
export const AIRBNB_TAIL_END_DAYS_MAX = 370;

const DAY_MS = 86_400_000;

export function isAirbnbNotAvailable(summary: string | null | undefined): boolean {
  return typeof summary === 'string' && AIRBNB_NOT_AVAILABLE.test(summary);
}

const valid = (d: unknown): d is Date => d instanceof Date && !Number.isNaN(d.getTime());

/**
 * «Airbnb (Not available)» that starts at today + a booking window (from `early` days before it to
 * AIRBNB_TAIL_FEED_TOLERANCE_DAYS after) and runs to about a year ahead.
 */
function isTail(summary: string | null | undefined, start: unknown, end: unknown, now: Date, early: number, endSlack: number): boolean {
  if (!isAirbnbNotAvailable(summary) || !valid(start) || !valid(end)) return false;
  const endDays = (end.getTime() - now.getTime()) / DAY_MS;
  if (endDays < AIRBNB_TAIL_END_DAYS_MIN - endSlack || endDays > AIRBNB_TAIL_END_DAYS_MAX) return false;
  const startDays = (start.getTime() - now.getTime()) / DAY_MS;
  return AIRBNB_WINDOW_DAYS.some((w) => startDays >= w - early && startDays <= w + AIRBNB_TAIL_FEED_TOLERANCE_DAYS);
}

/** An event of a feed read now is Airbnb's booking-window tail. */
export function isAirbnbWindowTail(
  summary: string | null | undefined,
  start: Date | null | undefined,
  end: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  return isTail(summary, start, end, now, AIRBNB_TAIL_FEED_TOLERANCE_DAYS, 0);
}

/** A booking imported from iCal earlier (notes hold the summary) was Airbnb's booking-window tail. */
export function isStoredAirbnbWindowTail(
  notes: string | null | undefined,
  checkIn: Date | null | undefined,
  checkOut: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  // Its fixed end is up to as many days nearer as its start.
  return isTail(notes, checkIn, checkOut, now, AIRBNB_TAIL_STORED_TOLERANCE_DAYS, AIRBNB_TAIL_STORED_TOLERANCE_DAYS);
}
