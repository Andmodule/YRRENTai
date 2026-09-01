import { mapBookingToCalendarDto } from './calendar.service';
import type { BookingEntity } from '../booking/entities/booking.entity';

function bookingFixture(partial: Partial<BookingEntity>): BookingEntity {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    propertyId: '22222222-2222-2222-2222-222222222222',
    guestId: null,
    guestName: 'Test Guest',
    guestEmail: undefined,
    guestEmailAlias: null,
    guestPhone: undefined,
    checkIn: new Date('2026-08-28T21:00:00.000Z'),
    checkOut: new Date('2026-08-29T21:00:00.000Z'),
    totalPriceMinor: 10000,
    currency: 'EUR',
    guestsCount: 2,
    guestsAdults: undefined,
    guestsChildren: undefined,
    notes: undefined,
    internalNotes: null,
    paymentStatus: 'unpaid',
    otaPaymentHint: null,
    status: 'CONFIRMED',
    cancelledBy: undefined,
    zodomusReservationId: null,
    icalUid: null,
    zodomusChannelId: null,
    directSource: null,
    zodomusSynced: false,
    overbookingConflict: false,
    overbookingConflictWithBookingId: null,
    overbookingDetectedAt: null,
    createdBy: '33333333-3333-3333-3333-333333333333',
    createdAt: new Date(),
    updatedAt: new Date(),
    property: undefined as never,
    guest: null,
    ...partial,
  };
}

describe('mapBookingToCalendarDto', () => {
  it('uses property timezone so 29-30 stay 29-30 (not 28-29) on a UTC host', () => {
    const dto = mapBookingToCalendarDto(bookingFixture({}), 'Europe/Moscow');
    expect(dto.checkIn).toBe('2026-08-29');
    expect(dto.checkOut).toBe('2026-08-30');
  });

  it('formats noon-in-property-TZ instants as the selected calendar days', () => {
    const dto = mapBookingToCalendarDto(
      bookingFixture({
        checkIn: new Date('2026-08-29T09:00:00.000Z'), // noon Moscow
        checkOut: new Date('2026-08-30T09:00:00.000Z'),
      }),
      'Europe/Moscow',
    );
    expect(dto.checkIn).toBe('2026-08-29');
    expect(dto.checkOut).toBe('2026-08-30');
  });

  it('exposes overbookingConflict on calendar DTO', () => {
    const dto = mapBookingToCalendarDto(
      bookingFixture({
        overbookingConflict: true,
        overbookingConflictWithBookingId: '44444444-4444-4444-4444-444444444444',
      }),
      'Europe/Moscow',
    );
    expect(dto.overbookingConflict).toBe(true);
    expect(dto.overbookingConflictWithBookingId).toBe('44444444-4444-4444-4444-444444444444');
  });
});
