import { liveOverbookingIds } from './calendar-overbooking.util';

const P = 'prop-zgoda';
const day = (ymd: string) => new Date(`${ymd}T12:00:00.000Z`);
const stay = (id: string, from: string, to: string, over: Partial<{ status: string; propertyId: string; overbookingConflict: boolean }> = {}) => ({
  id,
  propertyId: over.propertyId ?? P,
  status: (over.status ?? 'CONFIRMED') as never,
  checkIn: day(from),
  checkOut: day(to),
  overbookingConflict: over.overbookingConflict ?? false,
});

describe('liveOverbookingIds', () => {
  it('a flagged stay that still overlaps a blocking one stays flagged', () => {
    const ids = liveOverbookingIds([stay('ota', '2026-11-27', '2026-11-28', { overbookingConflict: true }), stay('ical', '2026-11-27', '2026-11-29')]);
    expect([...ids]).toEqual(['ota']);
  });

  it('Zgoda 27.11: the other stay only starts on the check-out day → no conflict any more', () => {
    const ids = liveOverbookingIds([stay('ota', '2026-11-27', '2026-11-28', { overbookingConflict: true }), stay('ical', '2026-11-28', '2026-11-29')]);
    expect(ids.size).toBe(0);
  });

  it('the stay it clashed with was cancelled → no conflict', () => {
    const ids = liveOverbookingIds([
      stay('ota', '2026-11-27', '2026-11-28', { overbookingConflict: true }),
      stay('old', '2026-11-26', '2026-11-29', { status: 'CANCELLED' }),
    ]);
    expect(ids.size).toBe(0);
  });

  it('another property, or the flagged stay itself, does not count', () => {
    const ids = liveOverbookingIds([
      stay('ota', '2026-11-27', '2026-11-28', { overbookingConflict: true }),
      stay('x', '2026-11-27', '2026-11-28', { propertyId: 'other' }),
    ]);
    expect(ids.size).toBe(0);
  });

  it('a stay without the flag is never reported, even when it overlaps', () => {
    const ids = liveOverbookingIds([stay('a', '2026-11-27', '2026-11-29'), stay('b', '2026-11-28', '2026-11-30')]);
    expect(ids.size).toBe(0);
  });

  it('a cancelled flagged stay is not a conflict', () => {
    const ids = liveOverbookingIds([
      stay('ota', '2026-11-27', '2026-11-28', { overbookingConflict: true, status: 'CANCELLED' }),
      stay('b', '2026-11-27', '2026-11-28'),
    ]);
    expect(ids.size).toBe(0);
  });

  it('a pending stay still blocks', () => {
    const ids = liveOverbookingIds([
      stay('ota', '2026-11-27', '2026-11-28', { overbookingConflict: true }),
      stay('b', '2026-11-26', '2026-11-28', { status: 'PENDING' }),
    ]);
    expect([...ids]).toEqual(['ota']);
  });
});
