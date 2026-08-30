import type { QueryClient } from '@tanstack/react-query';
import type { BookingChannel, BookingStatus, Property, Reservation } from '../types';
import { parseLocalCalendarDay } from './calendar-api-dates';
import { format } from 'date-fns';

interface CalendarApiResponse {
  properties: Property[];
  reservations: Reservation[];
}

/** Shape of BookingEntity returned by POST/PATCH /bookings. */
export interface ApiBooking {
  id: string;
  propertyId: string;
  guestName: string;
  guestEmail?: string | null;
  guestPhone?: string | null;
  guestsCount?: number | null;
  notes?: string | null;
  directSource?: string | null;
  totalPriceMinor: number;
  currency: string;
  status: string;
  checkIn: string;
  checkOut: string;
  zodomusReservationId?: string | null;
  zodomusChannelId?: number | null;
  paymentStatus?: 'unpaid' | 'partial' | 'paid';
}

function mapApiBookingStatus(status: string): BookingStatus {
  switch (status) {
    case 'CONFIRMED':
    case 'CHECKED_IN':
      return 'confirmed';
    case 'CHECKED_OUT':
      return 'cleaning';
    case 'CANCELLED':
    case 'DECLINED':
    case 'NO_SHOW':
      return 'cancelled';
    default:
      return 'pending';
  }
}

function mapApiBookingChannel(b: ApiBooking): BookingChannel {
  const zid = b.zodomusChannelId;
  if (zid == null) return 'direct';
  if (zid === 1) return 'booking';
  if (zid === 3) return 'airbnb';
  return 'other';
}

/**
 * Convert booking API ISO to calendar `yyyy-MM-dd`.
 * Prefer an explicit calendar day (from the form) when provided; otherwise derive from the
 * ISO instant using UTC date parts when time is midday-ish, else local format.
 * Avoids bare `format(new Date(iso))` which shifts a day west of UTC for local-midnight storage.
 */
export function formatCalendarDayFromIso(iso: string, preferredYmd?: string): string {
  if (preferredYmd && /^\d{4}-\d{2}-\d{2}$/.test(preferredYmd.trim())) {
    return preferredYmd.trim();
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return format(parseLocalCalendarDay(new Date().toISOString().slice(0, 10)), 'yyyy-MM-dd');
  }
  // Noon-ish UTC (±6h around 12:00) → use UTC calendar day (matches noon-in-TZ storage).
  const utcHours = d.getUTCHours();
  if (utcHours >= 6 && utcHours <= 18) {
    return d.toISOString().slice(0, 10);
  }
  // Local-midnight encodings (e.g. 21:00Z for UTC+3): use local calendar day of the browser,
  // which matches what the manager selected in `<input type="date">`.
  return format(d, 'yyyy-MM-dd');
}

export function mapApiBookingToReservation(
  b: ApiBooking,
  preferredDays?: { checkIn?: string; checkOut?: string },
): Reservation {
  return {
    uuid: b.id,
    externalId: b.zodomusReservationId?.trim() || b.id,
    fromOta: Boolean(b.zodomusReservationId?.trim()),
    propertyId: b.propertyId,
    guestName: b.guestName,
    guestEmail: b.guestEmail?.trim() ? b.guestEmail.trim() : null,
    guestPhone: b.guestPhone?.trim() ? b.guestPhone.trim() : null,
    guestsCount:
      b.guestsCount != null && Number.isFinite(Number(b.guestsCount)) && Number(b.guestsCount) > 0
        ? Math.round(Number(b.guestsCount))
        : null,
    guestsAdults: null,
    guestsChildren: null,
    notes: b.notes?.trim() ? b.notes.trim() : null,
    internalNotes: null,
    paymentStatus: b.paymentStatus ?? 'unpaid',
    otaPaymentHint: null,
    directSource: b.directSource?.trim() ? b.directSource.trim() : null,
    channel: mapApiBookingChannel(b),
    status: mapApiBookingStatus(b.status),
    totalPrice: b.totalPriceMinor / 100,
    currency: b.currency,
    checkIn: formatCalendarDayFromIso(b.checkIn, preferredDays?.checkIn),
    checkOut: formatCalendarDayFromIso(b.checkOut, preferredDays?.checkOut),
    chatThreadId: null,
  };
}

/** Insert or replace a reservation in all cached `/calendar` windows (instant UI after create/edit). */
export function upsertReservationInCalendarCache(
  queryClient: QueryClient,
  reservation: Reservation,
): void {
  queryClient.setQueriesData<CalendarApiResponse>({ queryKey: ['calendar'] }, (old) => {
    if (!old?.reservations) return old;
    const idx = old.reservations.findIndex((r) => r.uuid === reservation.uuid);
    const reservations =
      idx >= 0
        ? old.reservations.map((r, i) => (i === idx ? reservation : r))
        : [...old.reservations, reservation];
    return { ...old, reservations };
  });
}
