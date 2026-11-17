import { BOOKING_STATUSES_BLOCKING_AVAILABILITY, type BookingStatus } from '@rentai/shared';
import type { BookingEntity } from '../booking/entities/booking.entity';

type Stay = Pick<BookingEntity, 'id' | 'propertyId' | 'status' | 'checkIn' | 'checkOut' | 'overbookingConflict'>;

const BLOCKING = new Set<string>(BOOKING_STATUSES_BLOCKING_AVAILABILITY as readonly BookingStatus[]);

/**
 * Of the bookings flagged as an overbooking, the ones that still overlap another blocking booking of the same
 * property among `bookings` (the calendar's own window, which holds every booking that can overlap a shown one).
 * The flag is set once, when the channel booking comes in; the booking it clashed with may be cancelled or moved
 * since (an iCal stay replaced by its Zodomus twin, an Airbnb window tail) — then the red «Конфликт овербукинга»
 * was a false alarm (Zgoda 13 Lite 27.11.2026). Check-out day = next check-in day does not overlap.
 */
export function liveOverbookingIds(bookings: readonly Stay[]): Set<string> {
  const out = new Set<string>();
  const blocking = bookings.filter((b) => BLOCKING.has(b.status));
  for (const b of bookings) {
    if (!b.overbookingConflict || !BLOCKING.has(b.status)) continue;
    const clash = blocking.some(
      (o) =>
        o.id !== b.id &&
        o.propertyId === b.propertyId &&
        o.checkIn.getTime() < b.checkOut.getTime() &&
        o.checkOut.getTime() > b.checkIn.getTime(),
    );
    if (clash) out.add(b.id);
  }
  return out;
}
