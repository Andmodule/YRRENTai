import {
  differenceInCalendarDays,
  eachDayOfInterval,
  isWithinInterval,
  parseISO,
  startOfDay,
} from 'date-fns';
import type { CalendarDateRange, Reservation } from '../types';

function pluralizeBookings(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${n} броней`;
  if (mod10 === 1) return `${n} бронь`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} брони`;
  return `${n} броней`;
}

/** Day [d, d+1) overlaps booking [checkIn, checkOut) with exclusive checkOut */
function dayOverlapsBooking(day: Date, r: Reservation): boolean {
  const start = startOfDay(parseISO(r.checkIn));
  const endEx = startOfDay(parseISO(r.checkOut));
  return day >= start && day < endEx;
}

function countFreeDaysInRange(
  propertyId: string,
  reservations: Reservation[],
  dateRange: CalendarDateRange,
): number {
  const start = startOfDay(dateRange.start);
  const end = startOfDay(dateRange.end);
  const days = eachDayOfInterval({ start, end });
  let count = 0;
  for (const day of days) {
    const hasBooking = reservations.some(
      (r) => r.propertyId === propertyId && dayOverlapsBooking(day, r),
    );
    if (!hasBooking) count++;
  }
  return count;
}

export function getPropertyMeta(
  propertyId: string,
  reservations: Reservation[],
  dateRange: CalendarDateRange,
): string {
  const active = reservations.filter((r) => r.propertyId === propertyId && r.status !== 'blocked');
  if (active.length > 0) {
    return pluralizeBookings(active.length);
  }
  const freeDays = countFreeDaysInRange(propertyId, reservations, dateRange);
  return `Свободен ${freeDays} дн.`;
}

export function isDateRangeAroundToday(dateRange: CalendarDateRange): boolean {
  const today = startOfDay(new Date());
  return isWithinInterval(today, {
    start: startOfDay(dateRange.start),
    end: startOfDay(dateRange.end),
  });
}

export function countNights(checkIn: string, checkOut: string): number {
  return Math.max(0, differenceInCalendarDays(parseISO(checkOut), parseISO(checkIn)));
}
