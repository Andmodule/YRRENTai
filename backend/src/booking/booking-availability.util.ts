import { differenceInCalendarDays, parse } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/** Calendar nights between instants, using the property IANA timezone. */
export function nightsBetweenInPropertyTimezone(
  checkIn: Date,
  checkOut: Date,
  propertyTimezone: string,
): number {
  const ci = formatCalendarDayInTimezone(checkIn, propertyTimezone);
  const co = formatCalendarDayInTimezone(checkOut, propertyTimezone);
  return differenceInCalendarDays(parse(co, 'yyyy-MM-dd', new Date()), parse(ci, 'yyyy-MM-dd', new Date()));
}

/**
 * Format a timestamptz instant as a calendar day (`yyyy-MM-dd`) in the property IANA timezone.
 * Avoids Node/browser local-TZ off-by-one when the process runs in UTC.
 */
export function formatCalendarDayInTimezone(instant: Date, propertyTimezone: string): string {
  const tz = propertyTimezone?.trim() || 'UTC';
  return formatInTimeZone(instant, tz, 'yyyy-MM-dd');
}

/**
 * Convert a pure calendar day (`yyyy-MM-dd`) to a stable timestamptz at noon in the property timezone.
 * Noon avoids DST edge cases at midnight while preserving the same calendar day on round-trip format.
 */
export function calendarDayToInstantInTimezone(ymd: string, propertyTimezone: string): Date {
  const day = ymd.trim();
  const tz = propertyTimezone?.trim() || 'UTC';
  return fromZonedTime(`${day} 12:00:00`, tz);
}
