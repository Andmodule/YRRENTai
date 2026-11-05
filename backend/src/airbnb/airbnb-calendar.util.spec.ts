import {
  airbnbNights,
  airbnbPrice,
  availabilityOperations,
  basicPctOn,
  calendarOperations,
  chunk,
  closedTail,
  dateChangeOperations,
  operationsFingerprint,
  ownAirbnbPrices,
  weekdayOfYmd,
  type BasicDeal,
  type BookingNightForAirbnb,
} from './airbnb-calendar.util';

const night = (date: string, rack: number | null, closed = false): [string, BookingNightForAirbnb] => [date, { date, rack, closed }];

describe('basicPctOn — Booking shows the regular guest the biggest Basic deal', () => {
  const deals: BasicDeal[] = [
    { pct: 10, from: '2026-11-01', to: '2026-11-30', weekdays: null },
    { pct: 20, from: '2026-11-10', to: '2026-11-12', weekdays: null },
    { pct: 15, from: '2026-11-01', to: '2026-11-30', weekdays: ['Sat'] },
  ];
  it('takes the biggest, not the sum', () => {
    expect(basicPctOn('2026-11-11', deals)).toBe(20);
  });
  it('respects the stay window ends (inclusive) and weekdays', () => {
    expect(weekdayOfYmd('2026-11-14')).toBe('Sat');
    expect(basicPctOn('2026-11-14', deals)).toBe(15);
    expect(basicPctOn('2026-11-13', deals)).toBe(10);
    expect(basicPctOn('2026-11-30', deals)).toBe(10);
    expect(basicPctOn('2026-12-01', deals)).toBe(0);
    expect(basicPctOn('2026-11-12', deals)).toBe(20);
  });
  it('no deals → 0; nonsense percents ignored', () => {
    expect(basicPctOn('2026-11-11', [])).toBe(0);
    expect(basicPctOn('2026-11-11', [{ pct: 100, from: '2026-11-01', to: '2026-11-30', weekdays: null }])).toBe(0);
    expect(basicPctOn('2026-11-11', [{ pct: Number.NaN, from: '2026-11-01', to: '2026-11-30', weekdays: [] }])).toBe(0);
  });
});

describe('airbnbPrice', () => {
  it('rack minus the deal, whole złoty', () => {
    expect(airbnbPrice(500, 20, null)).toBe(400);
    expect(airbnbPrice(299, 10, null)).toBe(269); // 269.1
    expect(airbnbPrice(335, 10, null)).toBe(302); // 301.5 → 302
    expect(airbnbPrice(260, 0, null)).toBe(260);
  });
  it('never below the minimum price', () => {
    expect(airbnbPrice(170, 10, 160)).toBe(160);
    expect(airbnbPrice(170, 10, 150)).toBe(153);
  });
});

describe('airbnbNights', () => {
  const booking = new Map([night('2026-11-10', 500), night('2026-11-11', 500), night('2026-11-12', 1180, true), night('2026-11-13', null)]);
  const dates = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'];
  const deals: BasicDeal[] = [{ pct: 20, from: '2026-11-01', to: '2026-11-30', weekdays: null }];
  it('priced from Booking; closed, unpriced or unread nights have no price; occupancy kept', () => {
    expect(airbnbNights(booking, dates, deals, new Set(['2026-11-11']), null)).toEqual([
      { date: '2026-11-10', price: 400, occupied: false },
      { date: '2026-11-11', price: 400, occupied: true },
      { date: '2026-11-12', price: null, occupied: false },
      { date: '2026-11-13', price: null, occupied: false },
      { date: '2026-11-14', price: null, occupied: false },
    ]);
  });
});

describe('calendarOperations', () => {
  it('merges consecutive nights with the same state and price; the price goes with unavailable nights too', () => {
    const ops = calendarOperations([
      { date: '2026-11-12', price: null, occupied: false },
      { date: '2026-11-10', price: 400, occupied: false },
      { date: '2026-11-11', price: 400, occupied: false },
      { date: '2026-11-13', price: 400, occupied: true },
      { date: '2026-11-14', price: 300, occupied: false },
    ]);
    expect(ops).toEqual([
      { dates: ['2026-11-10:2026-11-11'], availability: 'available', dailyPrice: 400 },
      { dates: ['2026-11-12:2026-11-12'], availability: 'unavailable' },
      { dates: ['2026-11-13:2026-11-13'], availability: 'unavailable', dailyPrice: 400 },
      { dates: ['2026-11-14:2026-11-14'], availability: 'available', dailyPrice: 300 },
    ]);
  });
  it('an occupied run with different prices keeps each price', () => {
    expect(
      calendarOperations([
        { date: '2026-11-10', price: 400, occupied: true },
        { date: '2026-11-11', price: 350, occupied: true },
      ]),
    ).toEqual([
      { dates: ['2026-11-10:2026-11-10'], availability: 'unavailable', dailyPrice: 400 },
      { dates: ['2026-11-11:2026-11-11'], availability: 'unavailable', dailyPrice: 350 },
    ]);
  });
  it('a gap in dates starts a new operation; empty input → none', () => {
    expect(
      calendarOperations([
        { date: '2026-11-10', price: 400, occupied: false },
        { date: '2026-11-12', price: 400, occupied: false },
      ]),
    ).toHaveLength(2);
    expect(calendarOperations([])).toEqual([]);
  });
  it('crosses month and year ends', () => {
    const ops = calendarOperations([
      { date: '2026-12-31', price: 300, occupied: false },
      { date: '2027-01-01', price: 300, occupied: false },
    ]);
    expect(ops).toEqual([{ dates: ['2026-12-31:2027-01-01'], availability: 'available', dailyPrice: 300 }]);
  });
});

describe('closedTail', () => {
  it('closes N days from the plan end, both ends included', () => {
    expect(closedTail('2027-10-30', 730)).toEqual({ dates: ['2027-10-30:2029-10-28'], availability: 'unavailable' });
    expect(closedTail('2026-11-10', 1)).toEqual({ dates: ['2026-11-10:2026-11-10'], availability: 'unavailable' });
  });
});

describe('availabilityOperations — after a booking / cancellation', () => {
  const days = [
    { date: '2026-11-10', free: true },
    { date: '2026-11-11', free: false },
    { date: '2026-11-12', free: false },
    { date: '2026-11-13', free: true },
    { date: '2026-11-14', free: true },
    { date: '2026-11-15', free: true },
  ];
  it('occupied nights close; free nights reopen only before planEnd and with a price', () => {
    const ops = availabilityOperations(days, new Set(['2026-11-14']), '2026-11-15');
    expect(ops).toEqual([
      { dates: ['2026-11-10:2026-11-10'], availability: 'available' },
      { dates: ['2026-11-11:2026-11-12'], availability: 'unavailable' },
      { dates: ['2026-11-13:2026-11-13'], availability: 'available' },
      { dates: ['2026-11-14:2026-11-15'], availability: 'unavailable' },
    ]);
    expect(ops.every((o) => !('dailyPrice' in o))).toBe(true);
  });
  it('after a failed send (planEnd = today) or with no send at all, bookings still close and nothing opens', () => {
    const closedOnly = [{ dates: ['2026-11-10:2026-11-15'], availability: 'unavailable' }];
    expect(availabilityOperations(days, new Set(), null)).toEqual(closedOnly);
    expect(availabilityOperations(days, new Set(), '2026-11-10')).toEqual(closedOnly);
  });
  it('empty → none', () => {
    expect(availabilityOperations([], new Set(), '2027-01-01')).toEqual([]);
  });
});

describe('chunk / fingerprint', () => {
  it('splits into calls of at most N operations', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 50)).toEqual([]);
  });
  it('fingerprint changes with any price, date or listing', () => {
    const ops = [{ dates: ['2026-11-10:2026-11-11'], availability: 'available' as const, dailyPrice: 400 }];
    const f = operationsFingerprint('L', ops);
    expect(operationsFingerprint('L', ops)).toBe(f);
    expect(operationsFingerprint('L', [{ ...ops[0]!, dailyPrice: 401 }])).not.toBe(f);
    expect(operationsFingerprint('M', ops)).not.toBe(f);
    expect(operationsFingerprint('L', [{ ...ops[0]!, dates: ['2026-11-10:2026-11-12'] }])).not.toBe(f);
  });
});

describe('ownAirbnbPrices — owner rule 2026-11-05: typed for Airbnb, else base with the Airbnb markup', () => {
  const D = ['2026-11-06', '2026-11-07', '2026-11-08'];
  const base = new Map([['2026-11-06', 385], ['2026-11-07', 400]]);

  it('base × (100 + markup) / 100, whole złoty: 385 −30 % = 270, −10 % = 347 (346,5)', () => {
    expect(ownAirbnbPrices(D, base, new Map(), -30, null)).toEqual(new Map([['2026-11-06', 270], ['2026-11-07', 280]]));
    expect(ownAirbnbPrices(D, base, new Map(), -10, null).get('2026-11-06')).toBe(347);
  });

  it('a price typed for Airbnb wins over the formula, even on a night without a base', () => {
    const typed = new Map([['2026-11-06', 290], ['2026-11-08', 250]]);
    expect(ownAirbnbPrices(D, base, typed, -30, null)).toEqual(new Map([['2026-11-06', 290], ['2026-11-07', 280], ['2026-11-08', 250]]));
  });

  it('a night with neither is left out', () => {
    expect(ownAirbnbPrices(D, base, new Map(), 0, null).has('2026-11-08')).toBe(false);
  });

  it('never below the minimum — formula and typed alike (rounded up)', () => {
    const typed = new Map([['2026-11-07', 100]]);
    expect(ownAirbnbPrices(D, base, typed, -50, 200.4)).toEqual(new Map([['2026-11-06', 201], ['2026-11-07', 201]]));
  });

  it('no markup / not a number → the base, whole: 89,90 → 90', () => {
    const b = new Map([['2026-11-06', 89.9]]);
    expect(ownAirbnbPrices(D, b, new Map(), null, null).get('2026-11-06')).toBe(90);
    expect(ownAirbnbPrices(D, b, new Map(), Number.NaN, null).get('2026-11-06')).toBe(90);
  });

  it('a zero or negative typed price or base is ignored', () => {
    const typed = new Map([['2026-11-06', 0], ['2026-11-07', -5]]);
    const b = new Map([['2026-11-06', 385], ['2026-11-07', 400], ['2026-11-08', 0]]);
    expect(ownAirbnbPrices(D, b, typed, 0, null)).toEqual(new Map([['2026-11-06', 385], ['2026-11-07', 400]]));
  });

  it('only the dates asked', () => {
    expect(ownAirbnbPrices(['2026-11-07'], base, new Map([['2026-11-06', 290]]), 0, null)).toEqual(new Map([['2026-11-07', 400]]));
  });
});

describe('airbnbNights with own prices', () => {
  const booking = new Map([night('2026-11-06', 385), night('2026-11-07', 400, true), night('2026-11-08', null), night('2026-11-09', 300)]);
  const own = new Map([['2026-11-06', 270], ['2026-11-07', 280], ['2026-11-08', 210]]);
  const D = ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'];

  it('open on Booking: own wins; closed on Booking: no price even with own; no own: the Booking rule; unknown night: none', () => {
    const deals: BasicDeal[] = [{ pct: 20, from: '2026-01-01', to: '2026-12-31', weekdays: null }];
    expect(airbnbNights(booking, D, deals, new Set(['2026-11-08']), null, own)).toEqual([
      { date: '2026-11-06', price: 270, occupied: false },
      { date: '2026-11-07', price: null, occupied: false },
      { date: '2026-11-08', price: 210, occupied: true },
      { date: '2026-11-09', price: 240, occupied: false },
      { date: '2026-11-10', price: null, occupied: false },
    ]);
  });

  it('without own prices (flag off) nothing changes', () => {
    expect(airbnbNights(booking, D, [], new Set(), null)).toEqual(airbnbNights(booking, D, [], new Set(), null, null));
    expect(airbnbNights(booking, ['2026-11-06'], [], new Set(), null)[0]!.price).toBe(385);
  });
});

describe('dateChangeOperations with own prices', () => {
  it('a night opened on Booking goes available at its own Airbnb price', () => {
    const { ops, noPriceNights } = dateChangeOperations(
      [{ date: '2026-11-06', price: 385, closed: false }, { date: '2026-11-07', price: 400, closed: false }],
      [],
      [{ pct: 20, from: '2026-01-01', to: '2026-12-31', weekdays: null }],
      new Set(),
      null,
      '2027-01-01',
      ['2026-11-06'],
      new Map([['2026-11-06', 270]]),
    );
    expect(ops).toEqual([
      { dates: ['2026-11-06:2026-11-06'], availability: 'available', dailyPrice: 270 },
      { dates: ['2026-11-07:2026-11-07'], availability: 'available', dailyPrice: 320 },
    ]);
    expect(noPriceNights).toEqual([]);
  });
});

