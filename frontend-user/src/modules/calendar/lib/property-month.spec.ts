import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CalendarPromotion } from '../../pricing/api';
import type { Property, Reservation } from '../types';
import {
  buildMonthNights,
  inSelection,
  monthBounds,
  monthOf,
  monthWeeks,
  nextSelection,
  orderedRange,
  rangeFromFields,
  parseMonth,
  reservationsInSelection,
  shiftMonth,
  summarizeNights,
  typedBookingNights,
} from './property-month';

const PID = 'p1';

function prop(over: Partial<Property> = {}): Property {
  return { uuid: PID, title: 'K22', otaNightlyPrices: {}, otaBlockedDays: [], ...over };
}

function res(over: Partial<Reservation>): Reservation {
  return {
    uuid: 'r1',
    externalId: 'x',
    propertyId: PID,
    guestName: 'Anna',
    channel: 'booking',
    status: 'confirmed',
    totalPrice: 0,
    currency: 'PLN',
    checkIn: '2026-11-03',
    checkOut: '2026-11-05',
    chatThreadId: null,
    ...over,
  };
}

function promo(over: Partial<CalendarPromotion> & { state?: 'on' | 'pending' | 'skipped'; confirmed?: boolean }): CalendarPromotion {
  const { state = 'on', confirmed = true, ...rest } = over;
  return {
    id: 'pr1',
    name: 'Basic',
    discountPct: 10,
    source: 'rentai',
    promotionType: 'basic',
    from: '2026-11-01',
    to: '2026-11-30',
    activeWeekdays: null,
    properties: [{ propertyId: PID, state, confirmed, errorCode: null }],
    ...rest,
  } as CalendarPromotion;
}

function nights(over: Partial<Parameters<typeof buildMonthNights>[0]> = {}) {
  return buildMonthNights({
    from: '2026-11-01',
    to: '2026-11-30',
    today: '2026-11-02',
    property: prop({ otaNightlyPrices: { '2026-11-01': 300, '2026-11-02': 300, '2026-11-03': 300, '2026-11-06': 400, '2026-11-07': 1180 } }),
    reservations: [],
    promotions: [],
    geniusPct: 10,
    targetingPct: null,
    ...over,
  });
}

const byDay = (list: ReturnType<typeof nights>, ymd: string) => list.find((n) => n.ymd === ymd)!;

describe('month math', () => {
  it('bounds of 30-, 31-day months, February and leap February', () => {
    assert.deepEqual(monthBounds('2026-11'), { from: '2026-11-01', to: '2026-11-30' });
    assert.deepEqual(monthBounds('2026-12'), { from: '2026-12-01', to: '2026-12-31' });
    assert.deepEqual(monthBounds('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
    assert.deepEqual(monthBounds('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  });

  it('shifts across year ends', () => {
    assert.equal(shiftMonth('2026-12', 1), '2027-01');
    assert.equal(shiftMonth('2027-01', -1), '2026-12');
    assert.equal(shiftMonth('2026-10', 0), '2026-10');
    assert.equal(shiftMonth('2026-10', 14), '2027-12');
  });

  it('monthOf', () => {
    assert.equal(monthOf('2026-11-15'), '2026-11');
  });

  it('parses only real months from the address bar', () => {
    assert.equal(parseMonth('2026-11'), '2026-11');
    for (const bad of [null, undefined, '', '2026-13', '2026-00', '2026-1', '1999-12', '2101-01', '2026-11-01', 'abc']) {
      assert.equal(parseMonth(bad as string | null | undefined), null, String(bad));
    }
  });

  it('weeks start on Monday, padded with null', () => {
    // 2026-11-01 is a Sunday: six empty cells first; 30 days → 6 weeks.
    const w = monthWeeks('2026-11');
    assert.equal(w.length, 6);
    assert.deepEqual(w[0], [null, null, null, null, null, null, '2026-11-01']);
    assert.deepEqual(w[5], ['2026-11-30', null, null, null, null, null, null]);
    assert.ok(w.every((row) => row.length === 7));
  });

  it('a month starting on Monday has no lead cells; Feb 2027 fits 4 weeks', () => {
    assert.equal(monthWeeks('2027-02')[0]![0], '2027-02-01'); // Monday
    assert.equal(monthWeeks('2027-02').length, 4);
    assert.equal(monthWeeks('2027-02').flat().filter(Boolean).length, 28);
  });
});

describe('selection', () => {
  it('click → one night, second click → range, third → starts over', () => {
    const a = nextSelection(null, '2026-11-10');
    assert.deepEqual(a, { from: '2026-11-10', to: '2026-11-10' });
    const b = nextSelection(a, '2026-11-12');
    assert.deepEqual(b, { from: '2026-11-10', to: '2026-11-12' });
    assert.deepEqual(nextSelection(b, '2026-11-20'), { from: '2026-11-20', to: '2026-11-20' });
  });

  it('second click before the first orders the range', () => {
    assert.deepEqual(nextSelection({ from: '2026-11-10', to: '2026-11-10' }, '2026-11-08'), { from: '2026-11-08', to: '2026-11-10' });
  });

  it('click on the only picked night clears it', () => {
    assert.equal(nextSelection({ from: '2026-11-10', to: '2026-11-10' }, '2026-11-10'), null);
  });

  it('inSelection includes both ends', () => {
    const s = { from: '2026-11-10', to: '2026-11-12' };
    assert.ok(inSelection(s, '2026-11-10') && inSelection(s, '2026-11-12'));
    assert.ok(!inSelection(s, '2026-11-13') && !inSelection(null, '2026-11-10'));
  });
});

describe('buildMonthNights', () => {
  it('one entry per day; past and today flags', () => {
    const list = nights();
    assert.equal(list.length, 30);
    assert.ok(byDay(list, '2026-11-01').past);
    assert.ok(byDay(list, '2026-11-02').today && !byDay(list, '2026-11-02').past);
  });

  it('open night: prices of a regular guest, Genius, no app price without targeting', () => {
    const n = byDay(nights(), '2026-11-01');
    assert.equal(n.kind, 'open');
    assert.equal(n.rack, 300);
    assert.deepEqual({ regular: n.prices!.regular, genius: n.prices!.genius, app: n.prices!.app }, { regular: 300, genius: 270, app: null });
  });

  it('night without a Booking price is unknown, not open', () => {
    const n = byDay(nights(), '2026-11-20');
    assert.equal(n.kind, 'unknown');
    assert.equal(n.prices, null);
  });

  it('zero / negative / NaN price counts as no price', () => {
    const list = nights({ property: prop({ otaNightlyPrices: { '2026-11-01': 0, '2026-11-02': -5, '2026-11-03': Number.NaN } }) });
    for (const d of ['2026-11-01', '2026-11-02', '2026-11-03']) assert.equal(byDay(list, d).kind, 'unknown', d);
  });

  it('a live confirmed deal lowers the regular price; Genius applies on top', () => {
    const n = byDay(nights({ promotions: [promo({})] }), '2026-11-06');
    assert.equal(n.prices!.deal?.discountPct, 10);
    assert.equal(n.prices!.regular, 360);
    assert.equal(n.prices!.genius, 324);
  });

  it('pending, unconfirmed and not-sent deals do not change the price but are listed', () => {
    for (const p of [promo({ state: 'pending' }), promo({ confirmed: false }), promo({ state: 'skipped' })]) {
      const n = byDay(nights({ promotions: [p] }), '2026-11-06');
      assert.equal(n.prices!.regular, 400);
      assert.equal(n.promotions.length, 1);
    }
  });

  it('Mobile rate: property-wide percent, or the live one of the night', () => {
    const n = byDay(nights({ targetingPct: 10 }), '2026-11-06');
    assert.equal(n.targetingPct, 10);
    assert.equal(n.prices!.app, 324); // 400 × 0.9 (Genius) × 0.9 (Mobile)
    const m = byDay(
      nights({ targetingPct: 10, promotions: [promo({ id: 'm', promotionType: 'mobile_rate', discountPct: 15 })] }),
      '2026-11-06',
    );
    assert.equal(m.targetingPct, 15);
    assert.equal(m.prices!.regular, 400); // a Mobile rate is not the price of the night
  });

  it('booking in RentAI: nights up to check-out, arrival flag, no prices, no discounts', () => {
    const list = nights({ reservations: [res({})], promotions: [promo({})] });
    assert.equal(byDay(list, '2026-11-03').kind, 'booked');
    assert.ok(byDay(list, '2026-11-03').arrival);
    assert.equal(byDay(list, '2026-11-04').kind, 'booked');
    assert.ok(!byDay(list, '2026-11-04').arrival);
    assert.notEqual(byDay(list, '2026-11-05').kind, 'booked'); // check-out day is free
    assert.equal(byDay(list, '2026-11-03').prices, null);
    assert.equal(byDay(list, '2026-11-03').rack, 300); // the price of the date is still known
    assert.equal(byDay(list, '2026-11-03').promotions.length, 0);
  });

  it('cancelled bookings, other properties and channel-closed bars are not bookings', () => {
    const list = nights({
      reservations: [
        res({ status: 'cancelled' }),
        res({ uuid: 'r2', propertyId: 'other' }),
        res({ uuid: 'r3', otaInventoryBlock: true, status: 'blocked' }),
      ],
    });
    assert.equal(byDay(list, '2026-11-03').kind, 'open');
  });

  it('a block made in RentAI is `blocked`', () => {
    assert.equal(byDay(nights({ reservations: [res({ status: 'blocked' })] }), '2026-11-03').kind, 'blocked');
  });

  it('closed on Booking (blocked days or a `closed` restriction) — even with a price', () => {
    const list = nights({
      property: prop({
        otaNightlyPrices: { '2026-11-07': 1180, '2026-11-08': 300 },
        otaBlockedDays: ['2026-11-07'],
        otaRestrictions: [{ date: '2026-11-08', kind: 'closed' }],
      }),
    });
    assert.equal(byDay(list, '2026-11-07').kind, 'closed');
    assert.equal(byDay(list, '2026-11-08').kind, 'closed');
    assert.equal(byDay(list, '2026-11-07').prices, null);
  });

  it('a RentAI booking wins over a closed Booking night', () => {
    const list = nights({ property: prop({ otaBlockedDays: ['2026-11-03'] }), reservations: [res({})] });
    assert.equal(byDay(list, '2026-11-03').kind, 'booked');
  });

  it('restrictions: min stay > 1, closed to arrival / departure', () => {
    const list = nights({
      property: prop({
        otaNightlyPrices: { '2026-11-10': 300 },
        otaRestrictions: [
          { date: '2026-11-10', kind: 'minStay', minStay: 3 },
          { date: '2026-11-10', kind: 'closedOnArrival' },
          { date: '2026-11-11', kind: 'minStay', minStay: 1 },
          { date: '2026-11-12', kind: 'closedOnDeparture' },
        ],
      }),
    });
    assert.equal(byDay(list, '2026-11-10').minStay, 3);
    assert.ok(byDay(list, '2026-11-10').closedOnArrival);
    assert.equal(byDay(list, '2026-11-11').minStay, null);
    assert.ok(byDay(list, '2026-11-12').closedOnDeparture);
  });

  it('rate name of the night', () => {
    const list = nights({
      property: prop({ otaNightlyPrices: { '2026-11-10': 300 }, otaNightlyPriceMeta: { '2026-11-10': { rateId: '1', rateName: 'Standard Rate' } } }),
    });
    assert.equal(byDay(list, '2026-11-10').rateName, 'Standard Rate');
    assert.equal(byDay(list, '2026-11-11').rateName, null);
  });

  it('a stray reversed or huge range stays short', () => {
    assert.equal(nights({ from: '2026-11-30', to: '2026-11-01' }).length, 0);
    assert.equal(nights({ from: '2026-01-01', to: '2027-12-31' }).length, 62);
  });
});

describe('summary and bookings of a selection', () => {
  it('counts nights from today on; average regular price of free nights', () => {
    const list = nights({
      property: prop({ otaNightlyPrices: { '2026-11-01': 999, '2026-11-02': 300, '2026-11-06': 400, '2026-11-07': 1180 }, otaBlockedDays: ['2026-11-07'] }),
      reservations: [res({})],
    });
    assert.deepEqual(summarizeNights(list), { open: 2, booked: 2, closed: 1, avgOpenPrice: 350 });
  });

  it('no free nights → no average', () => {
    assert.equal(summarizeNights(nights({ property: prop() })).avgOpenPrice, null);
  });

  it('bookings touching the selection, each once', () => {
    const list = nights({ reservations: [res({}), res({ uuid: 'r2', checkIn: '2026-11-10', checkOut: '2026-11-12' })] });
    assert.deepEqual(reservationsInSelection(list, { from: '2026-11-04', to: '2026-11-10' }).map((r) => r.uuid), ['r1', 'r2']);
    assert.deepEqual(reservationsInSelection(list, { from: '2026-11-05', to: '2026-11-09' }), []);
    assert.deepEqual(reservationsInSelection(list, null), []);
  });
});

describe('range by drag and by «С / По»', () => {
  it('orders a drag that goes backwards, keeps one going forward or one night', () => {
    assert.deepEqual(orderedRange('2026-10-27', '2026-10-21'), ['2026-10-21', '2026-10-27']);
    assert.deepEqual(orderedRange('2026-10-21', '2026-10-27'), ['2026-10-21', '2026-10-27']);
    assert.deepEqual(orderedRange('2026-10-21', '2026-10-21'), ['2026-10-21', '2026-10-21']);
  });

  const cur = { from: '2026-10-10', to: '2026-10-12' };
  const MIN = '2026-10-01';
  const MAX = '2026-10-31';

  it('moves one end from a field', () => {
    assert.deepEqual(rangeFromFields(cur, 'from', '2026-10-05', MIN, MAX), { from: '2026-10-05', to: '2026-10-12' });
    assert.deepEqual(rangeFromFields(cur, 'to', '2026-10-20', MIN, MAX), { from: '2026-10-10', to: '2026-10-20' });
  });

  it('makes one night when both ends meet', () => {
    assert.deepEqual(rangeFromFields(cur, 'to', '2026-10-10', MIN, MAX), { from: '2026-10-10', to: '2026-10-10' });
  });

  it('swaps the ends when «По» is before «С»', () => {
    assert.deepEqual(rangeFromFields(cur, 'to', '2026-10-03', MIN, MAX), { from: '2026-10-03', to: '2026-10-10' });
    assert.deepEqual(rangeFromFields(cur, 'from', '2026-10-25', MIN, MAX), { from: '2026-10-12', to: '2026-10-25' });
  });

  it('keeps the range when a field is emptied or broken', () => {
    assert.deepEqual(rangeFromFields(cur, 'from', '', MIN, MAX), cur);
    assert.deepEqual(rangeFromFields(cur, 'to', '2026-1', MIN, MAX), cur);
  });

  it('cuts the range to the month on screen, at both edges', () => {
    assert.deepEqual(rangeFromFields(cur, 'to', '2026-11-04', MIN, MAX), { from: '2026-10-10', to: '2026-10-31' });
    assert.deepEqual(rangeFromFields(cur, 'from', '2026-09-28', MIN, MAX), { from: '2026-10-01', to: '2026-10-12' });
    assert.deepEqual(rangeFromFields(cur, 'to', MAX, MIN, MAX), { from: '2026-10-10', to: '2026-10-31' });
  });

  it('keeps a one-day month window (min equals max)', () => {
    assert.deepEqual(rangeFromFields(cur, 'to', '2026-10-20', '2026-10-15', '2026-10-15'), { from: '2026-10-15', to: '2026-10-15' });
  });

  it('gives nothing when the range falls wholly outside the month', () => {
    const late = { from: '2026-11-02', to: '2026-11-05' };
    assert.equal(rangeFromFields(late, 'to', '2026-11-06', MIN, MAX), null);
    const early = { from: '2026-09-02', to: '2026-09-05' };
    assert.equal(rangeFromFields(early, 'from', '2026-09-01', MIN, MAX), null);
  });
});

describe('typedBookingNights', () => {
  const picked = [{ ymd: '2026-10-29' }, { ymd: '2026-10-30' }, { ymd: '2026-10-31' }];

  it('lists only the picked nights with their own Booking price, with the base price beside it', () => {
    assert.deepEqual(typedBookingNights(picked, { '2026-10-29': 260 }, { '2026-10-29': 250, '2026-10-30': 300 }), [
      { ymd: '2026-10-29', price: 260, base: 250 },
    ]);
  });

  it('is empty when no picked night has its own price (a typed night outside the range does not count)', () => {
    assert.deepEqual(typedBookingNights(picked, { '2026-11-01': 270 }, {}), []);
    assert.deepEqual(typedBookingNights([], { '2026-10-29': 260 }, {}), []);
  });

  it('keeps a typed night without a base price (base null)', () => {
    assert.deepEqual(typedBookingNights(picked, { '2026-10-31': 330 }, {}), [{ ymd: '2026-10-31', price: 330, base: null }]);
  });

  it('ignores a zero or negative typed price and sorts by date', () => {
    const out = typedBookingNights([...picked].reverse(), { '2026-10-29': 0, '2026-10-30': -5, '2026-10-31': 330, '2026-10-30x': 1 }, {});
    assert.deepEqual(out.map((n) => n.ymd), ['2026-10-31']);
    const all = typedBookingNights([...picked].reverse(), { '2026-10-29': 260, '2026-10-31': 330 }, {});
    assert.deepEqual(all.map((n) => n.ymd), ['2026-10-29', '2026-10-31']);
  });
});
