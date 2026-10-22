import {
  airbnbLengthOfStayDiscount,
  bookingNightDiscounts,
  compareWithObserved,
  guestPriceBreakdown,
  nightsBelowMinPrice,
  round2,
  type GuestPriceBreakdown,
} from './guest-price.util';

const cleaning = { kind: 'cleaning' as const, label: 'Уборка', amount: 59 };

function linesSum(b: GuestPriceBreakdown): number {
  return round2(b.lines.reduce((s, l) => s + l.amount, 0));
}

describe('guestPriceBreakdown — Booking', () => {
  // K22 Andersa, 25 → 26 Oct 2026, 2 adults, Genius + mobile; guest's «Данные бронирования» 2026-10-22.
  const observed = guestPriceBreakdown({
    nights: [
      {
        date: '2026-10-25',
        rack: 284,
        discounts: bookingNightDiscounts({
          ratePlanPct: 15,
          ratePlanLabel: 'Невозвратный',
          geniusPct: 19,
          dealPct: 10,
          targetingPct: 10,
        }),
      },
    ],
    fees: [cleaning],
    vatIncludedPct: 8,
  });

  it('reproduces the guest breakdown Booking showed, line by line', () => {
    expect(observed.lines).toEqual([
      { kind: 'rack', label: 'Тариф', amount: 284 },
      { kind: 'rate_plan', label: 'Невозвратный', amount: -42.6 },
      { kind: 'genius', label: 'Genius', amount: -45.87 },
      { kind: 'deal', label: 'Акция', amount: -19.55 },
      { kind: 'targeting', label: 'Мобильная цена', amount: -17.6 },
      { kind: 'cleaning', label: 'Уборка', amount: 59 },
    ]);
    expect(observed.original).toBe(300.4);
    expect(observed.room).toBe(158.38);
    expect(observed.total).toBe(217.38);
    expect(observed.vatIncluded).toBe(11.73);
    expect(observed.roomPerNight).toEqual([{ date: '2026-10-25', amount: 158.38 }]);
  });

  it('a hand-typed discount after Genius gives the same total — the 19 % Genius line is two tens', () => {
    const split = guestPriceBreakdown({
      nights: [
        {
          date: '2026-10-25',
          rack: 241.4,
          discounts: bookingNightDiscounts({
            geniusPct: 10,
            extraDiscounts: [{ label: 'Не видна RentAI', pct: 10 }],
            dealPct: 10,
            targetingPct: 10,
          }),
        },
      ],
      fees: [cleaning],
      vatIncludedPct: 8,
    });
    expect(split.lines.map((l) => [l.kind, l.amount])).toEqual([
      ['rack', 241.4],
      ['genius', -24.14],
      ['extra', -21.73],
      ['deal', -19.55],
      ['targeting', -17.6],
      ['cleaning', 59],
    ]);
    expect(split.total).toBe(217.38);
  });

  it('flags today’s formula (Genius → deal → mobile, no rate plan) as off by ~22 %', () => {
    const today = guestPriceBreakdown({
      nights: [
        { date: '2026-10-25', rack: 284, discounts: bookingNightDiscounts({ geniusPct: 10, dealPct: 10, targetingPct: 10 }) },
      ],
      fees: [cleaning],
    });
    expect(today.room).toBe(207.04);
    expect(today.total).toBe(266.04);
    const cmp = compareWithObserved(today.total, 217.38);
    expect(cmp.withinTolerance).toBe(false);
    expect(cmp.deltaPct).toBeCloseTo(22.38, 2);
    expect(compareWithObserved(observed.total, 217.38)).toEqual({ deltaPct: 0, withinTolerance: true });
  });

  it('merges the same discount across nights and keeps each night’s own deal', () => {
    const b = guestPriceBreakdown({
      nights: [
        { date: '2026-10-25', rack: 284, discounts: bookingNightDiscounts({ geniusPct: 10, dealPct: 10 }) },
        { date: '2026-10-26', rack: 290, discounts: bookingNightDiscounts({ geniusPct: 10 }) },
      ],
    });
    expect(b.lines).toEqual([
      { kind: 'rack', label: 'Тариф', amount: 574 },
      { kind: 'genius', label: 'Genius', amount: -57.4 },
      { kind: 'deal', label: 'Акция', amount: -25.56 },
    ]);
    expect(b.roomPerNight).toEqual([
      { date: '2026-10-25', amount: 230.04 },
      { date: '2026-10-26', amount: 261 },
    ]);
    expect(b.room).toBe(491.04);
    expect(b.total).toBe(491.04);
    expect(b.original).toBe(574);
  });

  it('lines always add up to the total, taxes on top included', () => {
    const b = guestPriceBreakdown({
      nights: [
        { date: '2026-11-02', rack: 333.33, discounts: bookingNightDiscounts({ geniusPct: 15, dealPct: 7, targetingPct: 12 }) },
        { date: '2026-11-03', rack: 199.99, discounts: bookingNightDiscounts({ ratePlanPct: 11, geniusPct: 15 }) },
        { date: '2026-11-04', rack: 250.5, discounts: [] },
      ],
      fees: [cleaning, { kind: 'pets', label: 'Питомцы', amount: 100 }],
      taxesOnTop: [{ label: 'Городской налог', amount: 7.5 }],
      vatIncludedPct: 8,
    });
    expect(linesSum(b)).toBe(b.total);
    expect(b.total).toBe(round2(b.room + b.fees + b.taxesOnTop));
    expect(b.taxesOnTop).toBe(7.5);
    // VAT sits inside the room only — not in the fees, not in a city tax on top.
    expect(b.vatIncluded).toBe(round2((b.room * 8) / 108));
  });
});

describe('guestPriceBreakdown — edge cases', () => {
  it('empty stay is all zeros', () => {
    const b = guestPriceBreakdown({ nights: [] });
    expect(b.total).toBe(0);
    expect(b.room).toBe(0);
    expect(b.original).toBe(0);
    expect(b.roomPerNight).toEqual([]);
    expect(b.vatIncluded).toBeNull();
  });

  it('skips zero, negative and NaN discounts; caps a discount at 100 %', () => {
    const b = guestPriceBreakdown({
      nights: [
        {
          date: '2026-10-25',
          rack: 100,
          discounts: [
            { kind: 'deal', label: 'Ноль', pct: 0 },
            { kind: 'deal', label: 'Минус', pct: -5 },
            { kind: 'deal', label: 'NaN', pct: Number.NaN },
          ],
        },
        { date: '2026-10-26', rack: 100, discounts: [{ kind: 'deal', label: 'Всё', pct: 150 }] },
      ],
    });
    expect(b.lines).toEqual([
      { kind: 'rack', label: 'Тариф', amount: 200 },
      { kind: 'deal', label: 'Всё', amount: -100 },
    ]);
    expect(b.roomPerNight).toEqual([
      { date: '2026-10-25', amount: 100 },
      { date: '2026-10-26', amount: 0 },
    ]);
  });

  it('a negative rack counts as zero; zero fees and taxes leave no line', () => {
    const b = guestPriceBreakdown({
      nights: [{ date: '2026-10-25', rack: -50, discounts: bookingNightDiscounts({ geniusPct: 10 }) }],
      fees: [{ kind: 'cleaning', label: 'Уборка', amount: 0 }],
      taxesOnTop: [{ label: 'Городской налог', amount: 0 }],
    });
    expect(b.lines).toEqual([{ kind: 'rack', label: 'Тариф', amount: 0 }]);
    expect(b.total).toBe(0);
  });

  it('VAT 0 or missing is reported as unknown', () => {
    const nights = [{ date: '2026-10-25', rack: 100, discounts: [] }];
    expect(guestPriceBreakdown({ nights, vatIncludedPct: 0 }).vatIncluded).toBeNull();
    expect(guestPriceBreakdown({ nights, vatIncludedPct: null }).vatIncluded).toBeNull();
  });
});

describe('bookingNightDiscounts', () => {
  it('keeps Booking order: rate plan → Genius → hand-typed → deal → mobile / country', () => {
    expect(
      bookingNightDiscounts({
        targetingPct: 10,
        dealPct: 5,
        extraDiscounts: [{ label: 'x', pct: 3 }, { label: 'zero', pct: 0 }],
        geniusPct: 10,
        ratePlanPct: 15,
      }).map((d) => d.kind),
    ).toEqual(['rate_plan', 'genius', 'extra', 'deal', 'targeting']);
  });

  it('leaves out zero and missing discounts', () => {
    expect(bookingNightDiscounts({ geniusPct: 0, dealPct: null })).toEqual([]);
    expect(bookingNightDiscounts({})).toEqual([]);
  });

  it('uses the given labels', () => {
    expect(bookingNightDiscounts({ dealPct: 10, dealLabel: 'RentAI', targetingPct: 8, targetingLabel: 'Страна' })).toEqual([
      { kind: 'deal', label: 'RentAI', pct: 10 },
      { kind: 'targeting', label: 'Страна', pct: 8 },
    ]);
  });
});

describe('airbnbLengthOfStayDiscount', () => {
  const p = { weeklyPct: 15, monthlyPct: 20 };

  it.each([
    [1, null],
    [6, null],
    [7, 'Скидка за неделю'],
    [27, 'Скидка за неделю'],
    [28, 'Скидка за месяц'],
    [60, 'Скидка за месяц'],
  ])('%i nights → %s', (nights, label) => {
    expect(airbnbLengthOfStayDiscount(nights, p)?.label ?? null).toBe(label);
  });

  it('falls back to the weekly discount when there is no monthly one', () => {
    expect(airbnbLengthOfStayDiscount(30, { weeklyPct: 15 })).toEqual({
      kind: 'length_of_stay',
      label: 'Скидка за неделю',
      pct: 15,
    });
  });

  it('no discounts set → none', () => {
    expect(airbnbLengthOfStayDiscount(30, {})).toBeNull();
  });

  it('applies to nights only, cleaning stays whole', () => {
    const nights = Array.from({ length: 7 }, (_, i) => {
      const discount = airbnbLengthOfStayDiscount(7, p);
      return { date: `2026-11-0${i + 1}`, rack: 276, discounts: discount ? [discount] : [] };
    });
    const b = guestPriceBreakdown({ nights, fees: [cleaning] });
    expect(b.lines).toEqual([
      { kind: 'rack', label: 'Тариф', amount: 1932 },
      { kind: 'length_of_stay', label: 'Скидка за неделю', amount: -289.8 },
      { kind: 'cleaning', label: 'Уборка', amount: 59 },
    ]);
    expect(b.room).toBe(1642.2);
    expect(b.total).toBe(1701.2);
  });
});

describe('nightsBelowMinPrice', () => {
  const b = { roomPerNight: [
    { date: '2026-10-25', amount: 158.38 },
    { date: '2026-10-26', amount: 160 },
    { date: '2026-10-27', amount: 175 },
  ] };

  it('lists nights strictly below the minimum', () => {
    expect(nightsBelowMinPrice(b, 160)).toEqual(['2026-10-25']);
  });

  it('no minimum set → nothing to flag', () => {
    expect(nightsBelowMinPrice(b, null)).toEqual([]);
    expect(nightsBelowMinPrice(b, 0)).toEqual([]);
  });
});

describe('compareWithObserved', () => {
  it('accepts a gap up to the tolerance, inclusive', () => {
    expect(compareWithObserved(101, 100)).toEqual({ deltaPct: 1, withinTolerance: true });
    expect(compareWithObserved(99, 100)).toEqual({ deltaPct: -1, withinTolerance: true });
    expect(compareWithObserved(101.01, 100)).toEqual({ deltaPct: 1.01, withinTolerance: false });
  });

  it('honours a custom tolerance', () => {
    expect(compareWithObserved(103, 100, 5).withinTolerance).toBe(true);
  });

  it('an empty or broken observation never passes', () => {
    expect(compareWithObserved(100, 0).withinTolerance).toBe(false);
    expect(compareWithObserved(100, Number.NaN).withinTolerance).toBe(false);
  });
});
