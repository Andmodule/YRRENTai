import {
  addDaysYmd,
  findOverlaps,
  guestPriceAfter,
  hasRentaiMarker,
  isBelowMinPrice,
  nightsCount,
  nightsInRange,
  normalizeWeekdays,
  promotionHash,
  promotionMarker,
  safeDiscountPct,
  todayInTz,
  weekdayOf,
} from './pricing-math.util';
import { parseAllowlist } from './pricing-config';

describe('dates', () => {
  it('today follows the property timezone', () => {
    const now = new Date('2026-10-04T23:30:00Z');
    expect(todayInTz('UTC', now)).toBe('2026-10-04');
    expect(todayInTz('Europe/Warsaw', now)).toBe('2026-10-05');
    expect(todayInTz('America/New_York', now)).toBe('2026-10-04');
    expect(todayInTz('Not/AZone', now)).toBe('2026-10-04');
  });

  it('adds days across month ends and counts nights inclusively', () => {
    expect(addDaysYmd('2026-10-31', 1)).toBe('2026-11-01');
    expect(nightsCount('2026-10-05', '2026-10-11')).toBe(7);
  });

  it('knows weekdays and filters nights', () => {
    expect(weekdayOf('2026-10-04')).toBe('Sun');
    expect(weekdayOf('2026-10-10')).toBe('Sat');
    expect(nightsInRange('2026-10-05', '2026-10-11', ['Sat', 'Sun'])).toEqual([
      '2026-10-10',
      '2026-10-11',
    ]);
    expect(nightsInRange('2026-10-05', '2026-10-06', null)).toEqual(['2026-10-05', '2026-10-06']);
  });

  it('normalizes weekdays (all seven / none = every day)', () => {
    expect(normalizeWeekdays(['Sun', 'Sat', 'sat'])).toEqual(['Sat', 'Sun']);
    expect(normalizeWeekdays(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])).toBeNull();
    expect(normalizeWeekdays([])).toBeNull();
    expect(normalizeWeekdays(null)).toBeNull();
  });
});

describe('Genius-aware minimum price', () => {
  it('applies Genius first, then the deal (420 → 378 → 340.2)', () => {
    expect(guestPriceAfter(420, 10, 10)).toBeCloseTo(340.2);
    expect(guestPriceAfter(420, null, 10)).toBeCloseTo(378);
  });

  it('computes the largest safe discount', () => {
    expect(safeDiscountPct(420, 10, 320)).toBe(15);
    expect(safeDiscountPct(290, 10, 240)).toBe(8);
    expect(safeDiscountPct(560, 15, 420)).toBe(11);
    expect(safeDiscountPct(340, 10, 260)).toBe(15); // 340·0.9·0.85 = 260.1 — still ok
    expect(safeDiscountPct(420, 10, null)).toBeNull();
    expect(safeDiscountPct(100, 0, 150)).toBeLessThanOrEqual(0);
  });

  it('stacks a Mobile / Country rate on top of Genius and the deal (300 → 270 → 243 → 218.7)', () => {
    expect(guestPriceAfter(300, 10, 10, 10)).toBeCloseTo(218.7);
    expect(guestPriceAfter(300, 10, 10, null)).toBeCloseTo(243);
    expect(guestPriceAfter(300, null, 10, 10)).toBeCloseTo(243);
    // Without the mobile rate −10% looks safe for a 230 minimum; with it the guest pays 218.7.
    expect(isBelowMinPrice(300, 10, 10, 230)).toBe(false);
    expect(isBelowMinPrice(300, 10, 10, 230, 10)).toBe(true);
    expect(safeDiscountPct(300, 10, 230)).toBe(14);
    expect(safeDiscountPct(300, 10, 230, 10)).toBe(5); // 300·0.9·0.9·0.95 = 230.85
    expect(isBelowMinPrice(300, 10, 5, 230, 10)).toBe(false);
    expect(isBelowMinPrice(300, 10, 6, 230, 10)).toBe(true);
  });

  it('agrees with isBelowMinPrice at the boundary', () => {
    expect(isBelowMinPrice(420, 10, 15, 320)).toBe(false);
    expect(isBelowMinPrice(420, 10, 16, 320)).toBe(true);
    expect(isBelowMinPrice(290, 10, 10, 240)).toBe(true);
    expect(isBelowMinPrice(290, 10, 10, null)).toBe(false);
  });
});

describe('findOverlaps', () => {
  const existing = [
    {
      promotionId: 'p1',
      name: 'Осенняя неделя',
      discountPct: 10,
      source: 'rentai' as const,
      from: '2026-10-06',
      to: '2026-10-12',
      propertyIds: ['a', 'b'],
    },
    {
      promotionId: 'pB',
      name: 'Горящее',
      discountPct: 15,
      source: 'booking' as const,
      from: '2026-10-04',
      to: '2026-10-07',
      propertyIds: ['c'],
    },
    {
      promotionId: 'p9',
      name: 'Ноябрь',
      discountPct: 5,
      source: 'rentai' as const,
      from: '2026-11-01',
      to: '2026-11-05',
      propertyIds: ['a'],
    },
  ];

  it('reports date/object intersections and which discount the guest sees', () => {
    const res = findOverlaps(
      { from: '2026-10-05', to: '2026-10-11', discountPct: 12, propertyIds: ['a', 'c'] },
      existing,
    );
    expect(res).toEqual([
      expect.objectContaining({
        promotionId: 'p1',
        from: '2026-10-06',
        to: '2026-10-11',
        propertyIds: ['a'],
        visible: 'new',
      }),
      expect.objectContaining({
        promotionId: 'pB',
        from: '2026-10-05',
        to: '2026-10-07',
        propertyIds: ['c'],
        visible: 'existing',
      }),
    ]);
  });

  it('marks equal discounts and ignores other properties / dates', () => {
    const res = findOverlaps(
      { from: '2026-10-10', to: '2026-10-10', discountPct: 10, propertyIds: ['b'] },
      existing,
    );
    expect(res).toHaveLength(1);
    expect(res[0]!.visible).toBe('equal');
    expect(
      findOverlaps(
        { from: '2026-12-01', to: '2026-12-02', discountPct: 10, propertyIds: ['a'] },
        existing,
      ),
    ).toEqual([]);
  });
});

describe('idempotency helpers', () => {
  it('hash is stable regardless of key order and changes with parameters', () => {
    const a = promotionHash({ discountPct: 10, stayFrom: '2026-10-06', roomIds: ['1'] });
    const b = promotionHash({ roomIds: ['1'], stayFrom: '2026-10-06', discountPct: 10 });
    expect(a).toBe(b);
    expect(promotionHash({ discountPct: 15, stayFrom: '2026-10-06', roomIds: ['1'] })).not.toBe(a);
  });

  it('marker is recognisable in a Booking promotion name', () => {
    const m = promotionMarker('1a2b3c4d-5e6f-7a8b-9c0d-112233445566', 2);
    expect(m).toBe('RentAI 1a2b3c4d-2');
    expect(m.length).toBeLessThanOrEqual(20);
    expect(hasRentaiMarker(m)).toBe(true);
    expect(hasRentaiMarker(` ${m} `)).toBe(true);
    expect(hasRentaiMarker('Summer Deal')).toBe(false);
    expect(hasRentaiMarker('RentAI promo')).toBe(false);
  });
});

describe('parseAllowlist', () => {
  it('splits by comma/space, lowercases, drops empties', () => {
    expect([...parseAllowlist(' A-1 , b-2  c-3,,')]).toEqual(['a-1', 'b-2', 'c-3']);
    expect(parseAllowlist(undefined).size).toBe(0);
    expect(parseAllowlist('').size).toBe(0);
  });
});
