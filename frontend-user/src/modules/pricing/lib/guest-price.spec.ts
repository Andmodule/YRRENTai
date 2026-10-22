import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChannelProfile } from '../api';
import {
  airbnbNightPrice,
  airbnbStayInput,
  bookingStayInput,
  compareWithObserved,
  gapPct,
  guestPriceBreakdown,
  nightsBelowMinPrice,
  type BookingNightSource,
} from './guest-price';
import type { CellPromotion } from './pricing-ui';

const labels = { cleaning: 'Уборка', cityTax: 'Городской налог', mobile: 'Мобильная цена', weekly: 'Неделя', monthly: 'Месяц' };

function profile(over: Partial<ChannelProfile> = {}): ChannelProfile {
  return {
    channel: 'booking',
    cleaningFee: null,
    vatIncludedPct: null,
    cityTaxPerGuestNight: null,
    extraDiscounts: [],
    weeklyPct: null,
    monthlyPct: null,
    nightly: null,
    weekendNightly: null,
    isDefault: false,
    ...over,
  };
}

function promo(over: Partial<CellPromotion> = {}): CellPromotion {
  return {
    id: 'p1',
    name: 'RentAI −10',
    discountPct: 10,
    source: 'rentai',
    promotionType: 'basic',
    state: 'on',
    confirmed: true,
    errorCode: null,
    ...over,
  };
}

function night(over: Partial<BookingNightSource> & { ymd: string }): BookingNightSource {
  return { rack: null, rackFrom: null, rateName: null, onSale: true, promotions: [], targetingPct: null, ...over };
}

describe('guestPriceBreakdown (same cases as the backend copy)', () => {
  it('reproduces the Booking breakdown of 25 → 26 Oct 2026 to the grosz', () => {
    const b = guestPriceBreakdown({
      nights: [
        {
          date: '2026-10-25',
          rack: 241.4,
          discounts: [
            { kind: 'genius', label: 'Genius', pct: 10 },
            { kind: 'extra', label: 'Не видна RentAI', pct: 10 },
            { kind: 'deal', label: 'Акция', pct: 10 },
            { kind: 'targeting', label: 'Мобильная цена', pct: 10 },
          ],
        },
      ],
      fees: [{ kind: 'cleaning', label: 'Уборка', amount: 59 }],
      vatIncludedPct: 8,
    });
    assert.deepEqual(
      b.lines.map((l) => l.amount),
      [241.4, -24.14, -21.73, -19.55, -17.6, 59],
    );
    assert.equal(b.room, 158.38);
    assert.equal(b.total, 217.38);
    assert.equal(b.vatIncluded, 11.73);
    assert.equal(b.original, 300.4);
  });

  it('flags the old formula as ~22 % off', () => {
    const cmp = compareWithObserved(266.04, 217.38);
    assert.equal(cmp.withinTolerance, false);
    assert.equal(cmp.deltaPct, 22.38);
  });

  it('below-minimum nights and tolerance edges', () => {
    assert.deepEqual(nightsBelowMinPrice({ roomPerNight: [{ date: 'a', amount: 158.38 }, { date: 'b', amount: 160 }] }, 160), ['a']);
    assert.deepEqual(compareWithObserved(101, 100), { deltaPct: 1, withinTolerance: true });
    assert.equal(compareWithObserved(101.01, 100).withinTolerance, false);
    assert.equal(compareWithObserved(1, 0).withinTolerance, false);
  });
});

describe('bookingStayInput', () => {
  const nights = [
    night({ ymd: '2026-10-25', rack: 284, rackFrom: 241.4, promotions: [promo()], targetingPct: 10 }),
    night({ ymd: '2026-10-26', rack: 290, rackFrom: null, promotions: [], targetingPct: null }),
  ];

  it('min: cheapest rate, Genius, hand-typed, live deal, mobile; fees from the profile', () => {
    const { input, missing } = bookingStayInput({
      nights,
      scenario: 'min',
      geniusPct: 10,
      profile: profile({ cleaningFee: 59, vatIncludedPct: 8, extraDiscounts: [{ label: 'X', pct: 10 }] }),
      guests: 2,
      labels,
    });
    assert.deepEqual(missing, []);
    assert.deepEqual(
      input.nights.map((n) => [n.date, n.rack, n.discounts.map((d) => d.kind)]),
      [
        ['2026-10-25', 241.4, ['genius', 'extra', 'deal', 'targeting']],
        // no cheaper rate known → Standard; no deal and no mobile rate that night
        ['2026-10-26', 290, ['genius', 'extra']],
      ],
    );
    assert.deepEqual(input.fees, [{ kind: 'cleaning', label: 'Уборка', amount: 59 }]);
    assert.equal(input.vatIncludedPct, 8);
  });

  it('regular: Standard rate and the live deal only', () => {
    const { input } = bookingStayInput({ nights, scenario: 'regular', geniusPct: 10, profile: null, guests: 2, labels });
    assert.deepEqual(
      input.nights.map((n) => [n.rack, n.discounts.map((d) => d.kind)]),
      [
        [284, ['deal']],
        [290, []],
      ],
    );
    assert.deepEqual(input.fees, []);
    assert.equal(input.vatIncludedPct, null);
  });

  it('a deal that is not on Booking (pending, unconfirmed, not sent) does not count', () => {
    for (const p of [promo({ state: 'pending' }), promo({ confirmed: false }), promo({ state: 'skipped' })]) {
      const { input } = bookingStayInput({
        nights: [night({ ymd: '2026-10-25', rack: 284, promotions: [p] })],
        scenario: 'regular',
        geniusPct: null,
        profile: null,
        guests: 2,
        labels,
      });
      assert.deepEqual(input.nights[0]!.discounts, []);
    }
  });

  it('nights with no price are left out and listed', () => {
    const { input, missing } = bookingStayInput({
      nights: [night({ ymd: '2026-10-25', rack: null }), night({ ymd: '2026-10-26', rack: 0 }), night({ ymd: '2026-10-27', rack: 300 })],
      scenario: 'min',
      geniusPct: null,
      profile: null,
      guests: 2,
      labels,
    });
    assert.deepEqual(missing, ['2026-10-25', '2026-10-26']);
    assert.equal(input.nights.length, 1);
  });

  it('a booked or closed night is left out even when Booking sent a price for it', () => {
    const { input, missing } = bookingStayInput({
      nights: [night({ ymd: '2026-10-25', rack: 284, onSale: false }), night({ ymd: '2026-10-26', rack: 290 })],
      scenario: 'min',
      geniusPct: 10,
      profile: null,
      guests: 2,
      labels,
    });
    assert.deepEqual(missing, ['2026-10-25']);
    assert.deepEqual(input.nights.map((n) => n.date), ['2026-10-26']);
  });

  it('a deal name longer than the server takes is cut to 120 characters', () => {
    const { input } = bookingStayInput({
      nights: [night({ ymd: '2026-10-25', rack: 284, promotions: [promo({ name: 'x'.repeat(200) })] })],
      scenario: 'regular',
      geniusPct: null,
      profile: null,
      guests: 2,
      labels,
    });
    assert.equal(input.nights[0]!.discounts[0]!.label.length, 120);
  });

  it('city tax is per guest per priced night', () => {
    const { input } = bookingStayInput({
      nights,
      scenario: 'regular',
      geniusPct: null,
      profile: profile({ cityTaxPerGuestNight: 2.5 }),
      guests: 3,
      labels,
    });
    assert.deepEqual(input.taxesOnTop, [{ label: 'Городской налог', amount: 15 }]);
  });
});

describe('Airbnb prices', () => {
  const p = profile({ channel: 'airbnb', nightly: 290, weekendNightly: 350, cleaningFee: 59, weeklyPct: 15, monthlyPct: 20 });

  it('a typed price wins; else Fri / Sat take the weekend price; else the weekday one', () => {
    assert.equal(airbnbNightPrice('2026-10-25', p, { '2026-10-25': 276 }), 276); // Sun, typed
    assert.equal(airbnbNightPrice('2026-10-30', p, {}), 350); // Fri
    assert.equal(airbnbNightPrice('2026-10-31', p, {}), 350); // Sat
    assert.equal(airbnbNightPrice('2026-11-01', p, {}), 290); // Sun
    assert.equal(airbnbNightPrice('2026-10-30', profile({ nightly: 290 }), {}), 290); // no weekend price
    assert.equal(airbnbNightPrice('2026-10-25', null, {}), null);
    assert.equal(airbnbNightPrice('2026-10-25', null, { '2026-10-25': 0 }), null);
  });

  it('1 night: price + cleaning, no length-of-stay discount', () => {
    const { input, missing } = airbnbStayInput({ dates: ['2026-10-25'], profile: p, nightPrices: { '2026-10-25': 276 }, guests: 2, labels });
    assert.deepEqual(missing, []);
    assert.equal(guestPriceBreakdown(input).total, 335);
  });

  it('7 nights: weekly discount on the nights only; 28 nights: monthly', () => {
    const week = Array.from({ length: 7 }, (_, i) => `2026-11-0${i + 2}`); // Mon 2 … Sun 8
    const w = guestPriceBreakdown(airbnbStayInput({ dates: week, profile: p, nightPrices: {}, guests: 2, labels }).input);
    // 5 × 290 + 2 × 350 = 2150; −15 % = 1827.50; + 59
    assert.equal(w.room, 1827.5);
    assert.equal(w.total, 1886.5);
    assert.equal(w.lines.find((l) => l.kind === 'length_of_stay')?.label, 'Неделя');

    const month = Array.from({ length: 28 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 10, 2 + i));
      return d.toISOString().slice(0, 10);
    });
    const m = guestPriceBreakdown(airbnbStayInput({ dates: month, profile: p, nightPrices: {}, guests: 2, labels }).input);
    assert.equal(m.lines.find((l) => l.kind === 'length_of_stay')?.label, 'Месяц');
  });

  it('nights with no Airbnb price are listed; the discount still goes by all picked nights', () => {
    const dates = Array.from({ length: 7 }, (_, i) => `2026-11-0${i + 2}`);
    const { input, missing } = airbnbStayInput({
      dates,
      profile: profile({ channel: 'airbnb', weeklyPct: 15 }),
      nightPrices: { '2026-11-02': 300 },
      guests: 2,
      labels,
    });
    assert.equal(missing.length, 6);
    assert.equal(input.nights.length, 1);
    assert.equal(input.nights[0]!.discounts[0]?.kind, 'length_of_stay');
  });
});

describe('gapPct', () => {
  it('Airbnb 335 vs Booking 217,38 → +54,11 %', () => {
    assert.equal(gapPct(217.38, 335), 54.11);
    assert.equal(gapPct(100, 90), -10);
    assert.equal(gapPct(0, 90), null);
  });
});
