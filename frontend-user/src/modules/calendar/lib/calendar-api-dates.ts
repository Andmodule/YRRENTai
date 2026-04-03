import { parse, startOfDay } from 'date-fns';

/**
 * Calendar API returns `checkIn` / `checkOut` as `yyyy-MM-dd`.
 * `parseISO('yyyy-MM-dd')` is UTC midnight and breaks Planby X-position vs local `startDate`.
 * Parse as a local calendar day instead.
 */
export function parseLocalCalendarDay(ymd: string): Date {
  const d = parse(ymd.trim(), 'yyyy-MM-dd', new Date());
  if (Number.isNaN(d.getTime())) {
    return startOfDay(new Date());
  }
  return startOfDay(d);
}
