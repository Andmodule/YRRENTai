import { applyOverbookingFlag, clearOverbookingFlag } from './zodomus-overbooking.util';

describe('zodomus-overbooking.util', () => {
  it('flags overlap with conflicting booking id and timestamp', () => {
    const row = {
      overbookingConflict: false,
      overbookingConflictWithBookingId: null as string | null,
      overbookingDetectedAt: null as Date | null,
      zodomusReservationId: 'OTA-1',
      propertyId: 'prop-1',
    };
    const at = new Date('2026-08-30T12:00:00.000Z');
    applyOverbookingFlag(row, { id: 'conflict-booking' }, at);

    expect(row.overbookingConflict).toBe(true);
    expect(row.overbookingConflictWithBookingId).toBe('conflict-booking');
    expect(row.overbookingDetectedAt).toEqual(at);
  });

  it('clears flag when no conflict', () => {
    const row = {
      overbookingConflict: true,
      overbookingConflictWithBookingId: 'old',
      overbookingDetectedAt: new Date(),
      zodomusReservationId: 'OTA-1',
      propertyId: 'prop-1',
    };
    applyOverbookingFlag(row, null);

    expect(row.overbookingConflict).toBe(false);
    expect(row.overbookingConflictWithBookingId).toBeNull();
    expect(row.overbookingDetectedAt).toBeNull();
  });

  it('clearOverbookingFlag resets markers', () => {
    const row = {
      overbookingConflict: true,
      overbookingConflictWithBookingId: 'x',
      overbookingDetectedAt: new Date(),
      zodomusReservationId: 'OTA-1',
      propertyId: 'prop-1',
    };
    clearOverbookingFlag(row);
    expect(row.overbookingConflict).toBe(false);
    expect(row.overbookingConflictWithBookingId).toBeNull();
  });
});
