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
    expect(days[0]!.minStayThrough).toBe(3);
    expect(days[1]!.availability).toBe(0);
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

  it('merges consecutive blocked days into ranges', () => {
    const { mergeBlockedDaysToRanges } = require('./zodomus-inventory.util') as typeof import('./zodomus-inventory.util');
    expect(
      mergeBlockedDaysToRanges(['2026-09-20', '2026-09-22', '2026-09-21', '2026-09-25']),
    ).toEqual([
      { checkIn: '2026-09-20', checkOut: '2026-09-23' },
      { checkIn: '2026-09-25', checkOut: '2026-09-26' },
    ]);
  });

  it('prefers Standard rate id when provided; else cheapest open rate', () => {
    const days = extractZodomusInventoryDays(
      {
        rooms: [
          {
            id: 'r1',
            dates: [
              {
                date: '2026-09-17',
                availability: '1',
                rates: [
                  { rateId: 'std', closed: '0', price: '600.0' },
                  { rateId: 'nr', closed: '0', price: '540.0' },
                  { rateId: 'closed', closed: '1', price: '999.0' },
                ],
              },
              {
                date: '2026-09-18',
                availability: '1',
                rates: [{ rateId: 'std', closed: '0', price: '700.0' }],
              },
            ],
          },
        ],
      },
      { preferRateId: 'std' },
    );
    const d0 = days[0]!;
    const d1 = days[1]!;
    expect(d0.price).toBe(600);
    expect(d0.priceRateId).toBe('std');
    expect(d0.priceFrom).toBe(540);
    expect(d0.priceFromRateId).toBe('nr');
    expect(d1.price).toBe(700);
    const withoutPrefer = extractZodomusInventoryDays({
      rooms: [
        {
          id: 'r1',
          dates: [
            {
              date: '2026-09-17',
              availability: '1',
              rates: [
                { rateId: 'std', closed: '0', price: '600.0' },
                { rateId: 'nr', closed: '0', price: '540.0' },
              ],
            },
          ],
        },
      ],
    });
    expect(withoutPrefer[0]!.price).toBe(540);
    const {
      sumStayNightlyPrices,
      collectOtaNightlyPrices,
      collectOtaNightlyPricesFrom,
      collectOtaNightlyPriceMeta,
      sumNightlyPriceMap,
    } = require('./zodomus-inventory.util') as typeof import('./zodomus-inventory.util');
    expect(sumStayNightlyPrices(days, '2026-09-17', '2026-09-19')).toBe(1300);
    expect(collectOtaNightlyPrices(days)).toEqual({
      '2026-09-17': 600,
      '2026-09-18': 700,
    });
    expect(collectOtaNightlyPricesFrom(days)['2026-09-17']).toBe(540);
    expect(collectOtaNightlyPriceMeta(days)['2026-09-17']).toEqual({
      rateId: 'std',
      rateName: null,
    });
    expect(sumNightlyPriceMap(collectOtaNightlyPrices(days), '2026-09-17', '2026-09-19')).toBe(1300);
    expect(sumNightlyPriceMap(collectOtaNightlyPrices(days), '2026-09-17', '2026-09-20')).toBeNull();
  });

  it('keeps price from closed rates for display while still marking night closed', () => {
    const days = extractZodomusInventoryDays(
      {
        rooms: [
          {
            id: 'r1',
            dates: [
              {
                date: '2026-10-01',
                availability: '0',
                booked: '1',
                rates: [
                  { rateId: 'std', closed: '1', price: '520.0' },
                  { rateId: 'nr', closed: '1', price: '480.0' },
                ],
              },
            ],
          },
        ],
      },
      { preferRateId: 'std' },
    );
    const closedDay = days[0]!;
    expect(closedDay.closed).toBe(true);
    expect(closedDay.price).toBe(520);
    expect(closedDay.priceRateId).toBe('std');
    expect(closedDay.priceFrom).toBe(480);
    const {
      collectOtaBlockedDays,
      sumStayNightlyPrices,
    } = require('./zodomus-inventory.util') as typeof import('./zodomus-inventory.util');
    expect(collectOtaBlockedDays(days)).toContain('2026-10-01');
    expect(sumStayNightlyPrices(days, '2026-10-01', '2026-10-02')).toBe(520);
  });

  it('excludes weekly/monthly from priceFrom when rate names are known', () => {
    const days = extractZodomusInventoryDays(
      {
        rooms: [
          {
            id: 'r1',
            dates: [
              {
                date: '2026-09-17',
                availability: '1',
                rates: [
                  { rateId: 'std', closed: '0', price: '600.0' },
                  { rateId: 'nr', closed: '0', price: '540.0' },
                  { rateId: 'mon', closed: '0', price: '420.0' },
                ],
              },
            ],
          },
        ],
      },
      {
        preferRateId: 'std',
        rateNamesById: {
          std: 'Standard Rate',
          nr: 'Non-refundable Rate',
          mon: 'Monthly rate',
        },
      },
    );
    const named = days[0]!;
    expect(named.price).toBe(600);
    expect(named.priceRateName).toBe('Standard Rate');
    expect(named.priceFrom).toBe(540);
    expect(named.priceFromRateId).toBe('nr');
  });

  it('merges multi-room availability with min avail (not last-write)', () => {
    const days = extractZodomusInventoryDays({
      rooms: [
        {
          id: 'room-busy',
          dates: [{ date: '2026-09-20', availability: '0', booked: '1', rates: [] }],
        },
        {
          id: 'room-free',
          dates: [{ date: '2026-09-20', availability: '1', booked: '0', rates: [] }],
        },
      ],
    });
    expect(days).toHaveLength(1);
    const merged = days[0]!;
    expect(merged.availability).toBe(0);
    expect(merged.booked).toBe(1);
    expect(collectOtaBlockedDays(days)).toEqual(['2026-09-20']);
  });

  it('filters availability to preferRoomId when set', () => {
    const days = extractZodomusInventoryDays(
      {
        rooms: [
          {
            id: 'room-busy',
            dates: [{ date: '2026-09-20', availability: '0', booked: '1' }],
          },
          {
            id: 'room-free',
            dates: [{ date: '2026-09-20', availability: '1', booked: '0' }],
          },
        ],
      },
      { preferRoomId: 'room-free' },
    );
    expect(days[0]!.availability).toBe(1);
    expect(collectOtaBlockedDays(days)).toEqual([]);
  });

  it('sumStayNightlyPrices returns null when a night lacks price', () => {
    const { sumStayNightlyPrices } =
      require('./zodomus-inventory.util') as typeof import('./zodomus-inventory.util');
    const days = extractZodomusInventoryDays({
      dates: [{ date: '2026-09-17', availability: 1, rates: [{ price: '100' }] }],
    });
    expect(sumStayNightlyPrices(days, '2026-09-17', '2026-09-19')).toBeNull();
  });
});
