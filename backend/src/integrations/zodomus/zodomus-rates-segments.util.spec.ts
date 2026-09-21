import {
  collectFreeNightKeys,
  isOtaFreeNight,
  mergeNightKeysToRanges,
  rateIdPresentInAvailability,
} from './zodomus-rates-segments.util';
import type { ZodomusInventoryDay } from './zodomus-inventory.util';

function day(
  date: string,
  overrides: Partial<ZodomusInventoryDay> = {},
): ZodomusInventoryDay {
  return {
    date,
    availability: 1,
    booked: 0,
    closed: false,
    closedOnArrival: false,
    closedOnDeparture: false,
    minStayArrival: null,
    minStayThrough: null,
    price: 100,
    ...overrides,
  };
}

describe('zodomus-rates-segments.util', () => {
  describe('isOtaFreeNight', () => {
    it('treats availability>0 and booked 0 as free', () => {
      expect(isOtaFreeNight(day('2026-10-01'))).toBe(true);
    });

    it('rejects booked>0, availability 0, or closed', () => {
      expect(isOtaFreeNight(day('2026-10-01', { booked: 1 }))).toBe(false);
      expect(isOtaFreeNight(day('2026-10-01', { availability: 0 }))).toBe(false);
      expect(isOtaFreeNight(day('2026-10-01', { closed: true }))).toBe(false);
    });
  });

  describe('collectFreeNightKeys + mergeNightKeysToRanges', () => {
    it('splits around a booked hole into two contiguous ranges', () => {
      const days = [
        day('2026-10-01'),
        day('2026-10-02'),
        day('2026-10-03', { booked: 1 }),
        day('2026-10-04'),
        day('2026-10-05'),
      ];
      const free = collectFreeNightKeys(days, '2026-10-01', '2026-10-06');
      expect(free).toEqual(['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-05']);
      expect(mergeNightKeysToRanges(free)).toEqual([
        { dateFrom: '2026-10-01', dateToExclusive: '2026-10-03' },
        { dateFrom: '2026-10-04', dateToExclusive: '2026-10-06' },
      ]);
    });

    it('returns empty when all nights booked or unavailable', () => {
      const days = [
        day('2026-10-01', { booked: 1 }),
        day('2026-10-02', { availability: 0 }),
      ];
      expect(collectFreeNightKeys(days, '2026-10-01', '2026-10-03')).toEqual([]);
      expect(mergeNightKeysToRanges([])).toEqual([]);
    });

    it('excludes CRM-blocked nights even when ARI is free', () => {
      const days = [day('2026-10-01'), day('2026-10-02'), day('2026-10-03')];
      const free = collectFreeNightKeys(
        days,
        '2026-10-01',
        '2026-10-04',
        new Set(['2026-10-02']),
      );
      expect(free).toEqual(['2026-10-01', '2026-10-03']);
      expect(mergeNightKeysToRanges(free)).toEqual([
        { dateFrom: '2026-10-01', dateToExclusive: '2026-10-02' },
        { dateFrom: '2026-10-03', dateToExclusive: '2026-10-04' },
      ]);
    });
  });

  describe('rateIdPresentInAvailability', () => {
    const body = {
      rooms: [
        {
          id: '1032263001',
          dates: [
            {
              date: '2026-10-01',
              availability: '1',
              booked: '0',
              rates: [
                { rateId: '10322630991', price: '100', closed: '0' },
                { rateId: '10322630992', price: '90', closed: '0' },
              ],
            },
          ],
        },
      ],
    };

    it('finds mapped rateId for room', () => {
      expect(rateIdPresentInAvailability(body, '1032263001', '10322630991')).toBe(true);
    });

    it('returns false for unmapped rateId', () => {
      expect(rateIdPresentInAvailability(body, '1032263001', '999999')).toBe(false);
    });
  });
});
