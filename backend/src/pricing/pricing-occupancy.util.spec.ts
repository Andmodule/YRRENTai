import {
  DEFAULT_OCCUPANCY_SETTINGS,
  OCCUPANCY_MAX_TIERS,
  bookedNights,
  occupancyPct,
  sortTiers,
  suggestTier,
  tiersProblem,
  ymdInTz,
} from './pricing-occupancy.util';

const TIERS = DEFAULT_OCCUPANCY_SETTINGS.tiers; // <10 → 12, <20 → 8, <30 → 5

describe('suggestTier — «сдано меньше X% → скидка Y%»', () => {
  it('picks the tier of the lowest threshold the occupancy is still below', () => {
    expect(suggestTier(TIERS, 0, 30)?.discountPct).toBe(12); // 0%
    expect(suggestTier(TIERS, 2, 30)?.discountPct).toBe(12); // 6.7%
    expect(suggestTier(TIERS, 4, 30)?.discountPct).toBe(8); // 13.3%
    expect(suggestTier(TIERS, 7, 30)?.discountPct).toBe(5); // 23.3%
    expect(suggestTier(TIERS, 12, 30)).toBeNull(); // 40%
  });

  it('exactly on a threshold is not «below» it', () => {
    expect(suggestTier(TIERS, 3, 30)?.discountPct).toBe(8); // exactly 10% → next tier
    expect(suggestTier(TIERS, 6, 30)?.discountPct).toBe(5); // exactly 20%
    expect(suggestTier(TIERS, 9, 30)).toBeNull(); // exactly 30% → no discount
  });

  it('does not depend on the order the tiers were typed in', () => {
    const shuffled = [TIERS[2]!, TIERS[0]!, TIERS[1]!];
    expect(suggestTier(shuffled, 0, 30)?.discountPct).toBe(12);
    expect(sortTiers(shuffled).map((t) => t.belowPct)).toEqual([10, 20, 30]);
  });

  it('a fully booked property and an empty window get no suggestion', () => {
    expect(suggestTier(TIERS, 30, 30)).toBeNull();
    expect(suggestTier(TIERS, 0, 0)).toBeNull();
  });

  it('a 100% threshold covers everything except a full house', () => {
    const one = [{ belowPct: 100, discountPct: 5 }];
    expect(suggestTier(one, 29, 30)?.discountPct).toBe(5);
    expect(suggestTier(one, 30, 30)).toBeNull();
  });
});

describe('tiersProblem', () => {
  it('accepts the defaults and a single tier', () => {
    expect(tiersProblem(TIERS)).toBeNull();
    expect(tiersProblem([{ belowPct: 50, discountPct: 10 }])).toBeNull();
    expect(tiersProblem([{ belowPct: 10, discountPct: 7 }, { belowPct: 20, discountPct: 7 }])).toBeNull();
  });

  it.each([
    ['no tiers', []],
    ['too many', Array.from({ length: OCCUPANCY_MAX_TIERS + 1 }, (_, i) => ({ belowPct: 10 + i, discountPct: 20 - i }))],
    ['threshold 0', [{ belowPct: 0, discountPct: 5 }]],
    ['threshold 101', [{ belowPct: 101, discountPct: 5 }]],
    ['fractional threshold', [{ belowPct: 12.5, discountPct: 5 }]],
    ['discount 0', [{ belowPct: 10, discountPct: 0 }]],
    ['discount 100', [{ belowPct: 10, discountPct: 100 }]],
    ['fractional discount', [{ belowPct: 10, discountPct: 7.5 }]],
    ['the same threshold twice', [{ belowPct: 10, discountPct: 12 }, { belowPct: 10, discountPct: 8 }]],
    ['a fuller property gets more', [{ belowPct: 10, discountPct: 5 }, { belowPct: 20, discountPct: 8 }]],
  ])('rejects %s', (_label, tiers) => {
    expect(tiersProblem(tiers)).toEqual(expect.any(String));
  });
});

describe('bookedNights', () => {
  const FROM = '2026-10-09';

  it('counts check-in day up to, not including, check-out day', () => {
    expect(bookedNights([{ checkIn: '2026-10-10', checkOut: '2026-10-13' }], FROM, 30)).toBe(3);
    expect(bookedNights([{ checkIn: '2026-10-10', checkOut: '2026-10-10' }], FROM, 30)).toBe(0);
  });

  it('cuts stays at both ends of the window', () => {
    // started before today: only the nights from today on
    expect(bookedNights([{ checkIn: '2026-10-05', checkOut: '2026-10-11' }], FROM, 30)).toBe(2);
    // runs past the window (9 Oct + 30 nights = up to 7 Nov inclusive)
    expect(bookedNights([{ checkIn: '2026-11-06', checkOut: '2026-11-20' }], FROM, 30)).toBe(2);
    // entirely outside
    expect(bookedNights([{ checkIn: '2026-09-01', checkOut: '2026-10-09' }], FROM, 30)).toBe(0);
    expect(bookedNights([{ checkIn: '2026-11-08', checkOut: '2026-11-10' }], FROM, 30)).toBe(0);
  });

  it('an overbooked night is one night, back-to-back stays do not overlap', () => {
    const stays = [
      { checkIn: '2026-10-10', checkOut: '2026-10-12' },
      { checkIn: '2026-10-11', checkOut: '2026-10-13' }, // overlaps the 11th
      { checkIn: '2026-10-13', checkOut: '2026-10-14' }, // starts on a check-out day
    ];
    expect(bookedNights(stays, FROM, 30)).toBe(4); // 10, 11, 12, 13
  });

  it('a window fully covered is full', () => {
    expect(bookedNights([{ checkIn: '2026-10-01', checkOut: '2026-12-01' }], FROM, 30)).toBe(30);
  });
});

describe('display helpers', () => {
  it('shows occupancy as a whole percent, rounded down', () => {
    expect(occupancyPct(3, 30)).toBe(10);
    expect(occupancyPct(2, 30)).toBe(6);
    expect(occupancyPct(29, 30)).toBe(96);
    expect(occupancyPct(30, 30)).toBe(100);
    expect(occupancyPct(0, 0)).toBe(0);
  });

  it('the shown percent never contradicts the tier that was picked', () => {
    // 2 of 21 nights is 9.5%: «below 10%» — and it must not be displayed as 10%
    expect(occupancyPct(2, 21)).toBe(9);
    expect(suggestTier(TIERS, 2, 21)?.belowPct).toBe(10);
    for (let total = 7; total <= 120; total++) {
      for (let booked = 0; booked <= total; booked++) {
        const tier = suggestTier(TIERS, booked, total);
        const shown = occupancyPct(booked, total);
        if (tier) expect(shown).toBeLessThan(tier.belowPct);
        else expect(shown).toBeGreaterThanOrEqual(30);
      }
    }
  });

  it('a stored instant becomes the calendar day of the property', () => {
    const noonWarsaw = new Date('2026-10-10T10:00:00Z');
    expect(ymdInTz(noonWarsaw, 'Europe/Warsaw')).toBe('2026-10-10');
    expect(ymdInTz(new Date('2026-10-10T23:30:00Z'), 'Europe/Warsaw')).toBe('2026-10-11');
    expect(ymdInTz(noonWarsaw, 'Not/AZone')).toBe('2026-10-10');
    expect(ymdInTz(noonWarsaw, null)).toBe('2026-10-10');
  });
});
