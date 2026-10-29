import {
  airbnbNights,
  airbnbPrice,
  availabilityOperations,
  basicPctOn,
  calendarOperations,
  chunk,
  operationsFingerprint,
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
  it('merges consecutive nights with the same price; occupied and unpriced nights go unavailable without price', () => {
    const ops = calendarOperations([
      { date: '2026-11-12', price: null, occupied: false },
      { date: '2026-11-10', price: 400, occupied: false },
      { date: '2026-11-11', price: 400, occupied: false },
      { date: '2026-11-13', price: 400, occupied: true },
      { date: '2026-11-14', price: 300, occupied: false },
    ]);
    expect(ops).toEqual([
      { dates: ['2026-11-10:2026-11-11'], availability: 'available', dailyPrice: 400 },
      { dates: ['2026-11-12:2026-11-13'], availability: 'unavailable' },
      { dates: ['2026-11-14:2026-11-14'], availability: 'available', dailyPrice: 300 },
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

describe('availabilityOperations — after a booking / cancellation', () => {
  it('occupied nights close; free nights reopen except those the last full send had no price for', () => {
    const ops = availabilityOperations(
      [
        { date: '2026-11-10', free: true },
        { date: '2026-11-11', free: false },
        { date: '2026-11-12', free: false },
        { date: '2026-11-13', free: true },
        { date: '2026-11-14', free: true },
      ],
      new Set(['2026-11-14']),
    );
    expect(ops).toEqual([
      { dates: ['2026-11-10:2026-11-10'], availability: 'available' },
      { dates: ['2026-11-11:2026-11-12'], availability: 'unavailable' },
      { dates: ['2026-11-13:2026-11-13'], availability: 'available' },
      { dates: ['2026-11-14:2026-11-14'], availability: 'unavailable' },
    ]);
    expect(ops.every((o) => !('dailyPrice' in o))).toBe(true);
  });
  it('empty → none', () => {
    expect(availabilityOperations([], new Set())).toEqual([]);
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
