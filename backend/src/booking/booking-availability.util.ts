import { differenceInCalendarDays, parse } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

/** Calendar nights between instants, using the property IANA timezone. */
export function nightsBetweenInPropertyTimezone(
  checkIn: Date,
  checkOut: Date,
  propertyTimezone: string,
): number {
  const ci = formatInTimeZone(checkIn, propertyTimezone, 'yyyy-MM-dd');
  const co = formatInTimeZone(checkOut, propertyTimezone, 'yyyy-MM-dd');
  return differenceInCalendarDays(parse(co, 'yyyy-MM-dd', new Date()), parse(ci, 'yyyy-MM-dd', new Date()));
}
