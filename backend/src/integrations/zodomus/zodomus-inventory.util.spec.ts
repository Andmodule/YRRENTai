import {
  collectOtaBlockedDays,
  enumerateStayNightKeys,
  evaluateStayAgainstInventory,
  extractZodomusInventoryDays,
} from './zodomus-inventory.util';

describe('zodomus-inventory.util', () => {
  it('extracts nested rates minStayThrough and availability', () => {
    const days = extractZodomusInventoryDays({
      rooms: [
        {
          id: 'r1',
          dates: [
            {
              date: '2026-09-13',
              availability: '1',
              booked: '0',
              rates: [{ rateId: 'x', minStayThrough: '3', closed: '0', price: '100' }],
            },
            {
              date: '2026-09-14',
              availability: '0',
              booked: '0',
              rates: [{ minStayThrough: '1' }],
            },
          ],
        },
      ],
    });
    expect(days).toHaveLength(2);
    expect(days[0].minStayThrough).toBe(3);
    expect(days[1].availability).toBe(0);
    expect(collectOtaBlockedDays(days)).toEqual(['2026-09-14']);
  });

  it('blocks short stays below minStayThrough', () => {
    const days = extractZodomusInventoryDays({
      date: '2026-09-13',
      availability: 1,
      booked: 0,
      rates: [{ minStayThrough: 3 }],
    });
    const result = evaluateStayAgainstInventory(days, '2026-09-13', '2026-09-14', 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('OTA_MIN_STAY');
      expect(result.minStayRequired).toBe(3);
    }
  });

  it('allows stay when nights meet minStay and inventory is open', () => {
    const days = extractZodomusInventoryDays({
      dates: [
        { date: '2026-09-13', availability: 1, booked: 0, rates: [{ minStayThrough: 3 }] },
        { date: '2026-09-14', availability: 1, booked: 0 },
        { date: '2026-09-15', availability: 1, booked: 0 },
      ],
    });
    const result = evaluateStayAgainstInventory(days, '2026-09-13', '2026-09-16', 3);
    expect(result).toEqual({ ok: true });
  });

  it('enumerates exclusive checkout nights', () => {
    expect(enumerateStayNightKeys('2026-09-13', '2026-09-15')).toEqual([
      '2026-09-13',
      '2026-09-14',
    ]);
  });
});
