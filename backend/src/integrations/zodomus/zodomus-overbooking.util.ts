import type { BookingEntity } from '../../booking/entities/booking.entity';

type OverbookingTarget = Pick<
  BookingEntity,
  | 'overbookingConflict'
  | 'overbookingConflictWithBookingId'
  | 'overbookingDetectedAt'
  | 'zodomusReservationId'
  | 'propertyId'
>;

/**
 * Marks inbound OTA booking as conflicting when it overlaps another blocking stay.
 * Always keeps the OTA booking (channel is source of truth).
 */
export function applyOverbookingFlag(
  row: OverbookingTarget,
  conflictWith: { id: string } | null,
  detectedAt: Date = new Date(),
): void {
  if (conflictWith) {
    row.overbookingConflict = true;
    row.overbookingConflictWithBookingId = conflictWith.id;
    row.overbookingDetectedAt = detectedAt;
    return;
  }
  row.overbookingConflict = false;
  row.overbookingConflictWithBookingId = null;
  row.overbookingDetectedAt = null;
}

/** Clear overbooking markers (cancel / resolved dates). */
export function clearOverbookingFlag(row: OverbookingTarget): void {
  applyOverbookingFlag(row, null);
}
