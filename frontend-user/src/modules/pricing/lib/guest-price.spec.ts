import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChannelProfile } from '../api';
import {
  airbnbNightPrice,
  airbnbStayInput,
  bookingStayInput,
  countBookedOrClosed,
  bookingCell,
  channelNightPrice,
  channelPriceFromBase,
  occupancyFactor,
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

describe('countBookedOrClosed', () => {
  it('counts booked, blocked and closed nights — not nights without a price', () => {
    const kinds = ['booked', 'blocked', 'closed', 'open', 'unknown', 'unknown'].map((kind) => ({ kind }));
    assert.equal(countBookedOrClosed(kinds), 3);
    assert.equal(countBookedOrClosed([{ kind: 'unknown' }, { kind: 'open' }]), 0);
    assert.equal(countBookedOrClosed([]), 0);
  });
});

describe('base price helpers (same as backend base-price.util)', () => {
  it('channelPriceFromBase rounds to whole units, half up', () => {
    assert.equal(channelPriceFromBase(500, 10), 550);
    assert.equal(channelPriceFromBase(500, -5), 475);
    assert.equal(channelPriceFromBase(284, 10), 312);
    assert.equal(channelPriceFromBase(290, -15), 247);
    assert.equal(channelPriceFromBase(500, null), 500);
    assert.equal(channelPriceFromBase(500, Number.NaN), 500);
    // no markup: the base as it is (a euro price 89,90 must not become 90)
    assert.equal(channelPriceFromBase(89.9, 0), 89.9);
    assert.equal(channelPriceFromBase(89.9, null), 89.9);
    assert.equal(channelPriceFromBase(89.9, 10), 99);
  });

  it('channelNightPrice: typed wins, else base × markup, else null', () => {
    const base = { '2026-11-01': 500, '2026-11-02': 500 };
    const typed = { '2026-11-02': 450, '2026-11-03': 480 };
    assert.equal(channelNightPrice('2026-11-01', base, typed, 10), 550);
    assert.equal(channelNightPrice('2026-11-02', base, typed, 10), 450);
    assert.equal(channelNightPrice('2026-11-03', base, typed, 10), 480);
    assert.equal(channelNightPrice('2026-11-04', base, typed, 10), null);
  });

  it('occupancyFactor: 1 guest − single %, each above two + extra %, no rule = 1', () => {
    const rule = { singleGuestPct: 10, extraGuestPct: 20 };
    assert.equal(occupancyFactor(1, rule), 0.9);
    assert.equal(occupancyFactor(2, rule), 1);
    assert.equal(occupancyFactor(3, rule), 1.2);
    assert.equal(occupancyFactor(4, rule), 1.4);
    assert.equal(occupancyFactor(1, null), 1);
    assert.equal(occupancyFactor(1, { singleGuestPct: null, extraGuestPct: null }), 1);
  });

  it('occupancy scales the rack of Booking and Airbnb nights', () => {
    const b = bookingStayInput({ nights: [night({ ymd: '2026-11-01', rack: 500 })], scenario: 'regular', geniusPct: null, profile: null, guests: 1, labels, occupancy: 0.9 });
    assert.equal(b.input.nights[0]!.rack, 450);
    const a = airbnbStayInput({ dates: ['2026-11-02'], profile: profile({ nightly: 300 }), nightPrices: {}, guests: 1, labels, occupancy: 0.9 });
    assert.equal(a.input.nights[0]!.rack, 270);
  });

  it('airbnbNightPrice: typed → base × Airbnb markup → profile price', () => {
    const p = profile({ channel: 'airbnb', nightly: 290, weekendNightly: 350 });
    const fromBase = { base: { '2026-11-02': 500 }, markupPct: -5 };
    assert.equal(airbnbNightPrice('2026-11-02', p, { '2026-11-02': 400 }, fromBase), 400);
    assert.equal(airbnbNightPrice('2026-11-02', p, {}, fromBase), 475);
    assert.equal(airbnbNightPrice('2026-11-03', p, {}, fromBase), 290);
    assert.equal(airbnbNightPrice('2026-11-03', p, {}, null), 290);
  });

  it('bookingCell: price, pending against Booking, typed, cheapest guest (room only)', () => {
    const n = night({ ymd: '2026-11-02', rack: 500, rackFrom: 500, promotions: [promo({ discountPct: 20 })], targetingPct: 10 });
    const c = bookingCell(n, { base: { '2026-11-02': 500 }, typed: {}, markupPct: 0, geniusPct: 10, profile: null })!;
    // 500 → Genius −10 % → 450 → deal −20 % → 360 → mobile −10 % → 324
    assert.deepEqual(c, { price: 500, typed: false, pending: false, minGuest: 324 });
    const up = bookingCell(n, { base: { '2026-11-02': 500 }, typed: {}, markupPct: 10, geniusPct: 10, profile: null })!;
    assert.equal(up.price, 550);
    assert.equal(up.pending, true);
    const typedCell = bookingCell(n, { base: {}, typed: { '2026-11-02': 600 }, markupPct: 0, geniusPct: null, profile: null })!;
    assert.equal(typedCell.typed, true);
    assert.equal(bookingCell(n, { base: {}, typed: {}, markupPct: 0, geniusPct: null, profile: null }), null);
  });

  it('bookingCell: no «not sent» mark on a night that is not on sale (closed placeholder price)', () => {
    const closed = night({ ymd: '2026-11-02', rack: 1180, onSale: false });
    const c = bookingCell(closed, { base: { '2026-11-02': 300 }, typed: {}, markupPct: 0, geniusPct: null, profile: null })!;
    assert.equal(c.price, 300);
    assert.equal(c.pending, false);
  });

  it('bookingCell keeps a cheaper open rate in proportion (non-refundable −15 %)', () => {
    const n = night({ ymd: '2026-11-02', rack: 300, rackFrom: 255 });
    const c = bookingCell(n, { base: { '2026-11-02': 400 }, typed: {}, markupPct: 0, geniusPct: null, profile: null })!;
    assert.equal(c.minGuest, 340);
  });
});
