import {
  MAX_WINDOW_NIGHTS,
  addDaysYmd,
  countChanges,
  extractRateNights,
  findMismatches,
  isWeekendNight,
  isYmd,
  mergeChangesToRanges,
  nightKeys,
  nightsBetween,
  planCalendarDates,
  planPriceTargets,
  splitWindows,
  weekdayOf,
  type NightChange,
  type RateNight,
} from './calendar-dates.util';
import { activeBookings } from '../integrations/zodomus/zodomus-inventory.util';

const ROOM = '1102139801';
const RATE = '39993723';

/** The shape Zodomus returned for K22 Andersa on 2026-10-12. */
function body(
  dates: Array<{
    date: string;
    closed?: string;
    price?: string;
    booked?: string;
    cancelled?: string;
    dayBooked?: string;
    dayCancelled?: string;
    availability?: string;
    rateId?: string;
  }>,
) {
  return {
    status: { returnCode: 200 },
    rooms: [
      {
        id: ROOM,
        dates: dates.map((d) => ({
          date: d.date,
          availability: d.availability ?? '1',
          booked: d.dayBooked ?? '',
          cancelled: d.dayCancelled ?? '',
          rates: [
            {
              rateId: d.rateId ?? RATE,
              closed: d.closed ?? '0',
              price: d.price ?? '330.0',
              booked: d.booked ?? '0',
              cancelled: d.cancelled ?? '0',
            },
          ],
        })),
      },
    ],
  };
}

function nights(list: Array<Partial<RateNight> & { date: string }>): Map<string, RateNight> {
  return new Map(list.map((n) => [n.date, { closed: false, price: 330, booked: 0, ...n }]));
}

describe('calendar-dates.util — dates', () => {
  it('accepts only real calendar dates between 2000 and 2100', () => {
    expect(isYmd('2026-11-01')).toBe(true);
    expect(isYmd('2028-02-29')).toBe(true);
    for (const bad of ['2026-13-01', '2026-11-1', '2026-02-30', '2027-02-29', '9999-99-99', '2999-12-31', '1999-12-31', '2026-00-10', '']) {
      expect(isYmd(bad)).toBe(false);
    }
    expect(isYmd(20261101)).toBe(false);
  });

  it('refuses to loop over a range that is not made of real dates', () => {
    expect(() => nightKeys('2026-11-01', '9999-99-99')).toThrow(RangeError);
    expect(() => splitWindows('2026-11-01', '2999-99-99')).toThrow(RangeError);
    expect(Number.isNaN(nightsBetween('2026-11-01', '9999-99-99'))).toBe(true);
  });

  it('adds days across month and year ends and DST', () => {
    expect(addDaysYmd('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysYmd('2026-10-24', 2)).toBe('2026-10-26'); // DST change in Europe
    expect(addDaysYmd('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('counts nights of an exclusive range', () => {
    expect(nightsBetween('2026-11-01', '2026-11-02')).toBe(1);
    expect(nightsBetween('2026-11-01', '2027-11-01')).toBe(365);
    expect(nightsBetween('2026-11-02', '2026-11-01')).toBe(0);
    expect(nightKeys('2026-11-30', '2026-12-02')).toEqual(['2026-11-30', '2026-12-01']);
    expect(nightKeys('2026-11-01', '2026-11-01')).toEqual([]);
  });

  it('knows days of the week and weekend nights (Friday, Saturday)', () => {
    expect(weekdayOf('2026-10-12')).toBe(1); // Monday
    expect(weekdayOf('2026-10-31')).toBe(6); // Saturday
    expect(isWeekendNight('2026-10-30')).toBe(true); // Friday night
    expect(isWeekendNight('2026-10-31')).toBe(true); // Saturday night
    expect(isWeekendNight('2026-11-01')).toBe(false); // Sunday night
  });

  it('splits a range into windows Zodomus accepts (≤ 28 nights)', () => {
    const w = splitWindows('2026-11-01', '2027-02-01');
    expect(w[0]).toEqual({ dateFrom: '2026-11-01', dateToExclusive: '2026-11-29' });
    expect(w[w.length - 1]!.dateToExclusive).toBe('2027-02-01');
    for (let i = 1; i < w.length; i++) expect(w[i]!.dateFrom).toBe(w[i - 1]!.dateToExclusive);
    for (const x of w) expect(nightsBetween(x.dateFrom, x.dateToExclusive)).toBeLessThanOrEqual(MAX_WINDOW_NIGHTS);
    expect(splitWindows('2026-11-01', '2026-11-29')).toHaveLength(1);
    expect(splitWindows('2026-11-01', '2026-11-30')).toHaveLength(2);
    expect(splitWindows('2026-11-01', '2026-11-01')).toEqual([]);
  });
});

describe('extractRateNights', () => {
  it('reads closed, price and booked of the asked rate', () => {
    const m = extractRateNights(
      body([
        { date: '2026-10-31', closed: '0', price: '330.0' },
        { date: '2026-11-01', closed: '1', price: '1180.0' },
        { date: '2026-11-02', closed: '1', price: '1180.0', booked: '1' },
      ]),
      ROOM,
      RATE,
    );
    expect(m.get('2026-10-31')).toEqual({ date: '2026-10-31', closed: false, price: 330, booked: 0, availability: 1 });
    expect(m.get('2026-11-01')).toEqual({ date: '2026-11-01', closed: true, price: 1180, booked: 0, availability: 1 });
    expect(m.get('2026-11-02')?.booked).toBe(1);
  });

  it('takes booked from the date level when the rate says nothing', () => {
    const m = extractRateNights(body([{ date: '2026-11-01', booked: '', dayBooked: '1' }]), ROOM, RATE);
    expect(m.get('2026-11-01')?.booked).toBe(1);
  });

  it('skips nights without the rate and treats zero / missing price as none', () => {
    const m = extractRateNights(
      body([
        { date: '2026-11-01', rateId: '999' },
        { date: '2026-11-02', price: '0' },
        { date: '2026-11-03', price: '' },
      ]),
      ROOM,
      RATE,
    );
    expect(m.has('2026-11-01')).toBe(false);
    expect(m.get('2026-11-02')?.price).toBeNull();
    expect(m.get('2026-11-03')?.price).toBeNull();
  });

  it('falls back to the only room when the room id differs, ignores other rooms otherwise', () => {
    const one = body([{ date: '2026-11-01' }]);
    expect(extractRateNights(one, 'other-room', RATE).size).toBe(1);
    const two = { rooms: [{ id: 'a', dates: [] }, ...one.rooms.map((r) => ({ ...r, id: 'b' }))] };
    expect(extractRateNights(two, 'other-room', RATE).size).toBe(0);
    expect(extractRateNights(two, 'b', RATE).size).toBe(1);
  });

  it('a cancelled reservation does not take the night (K22 Andersa, 2026-10-25)', () => {
    // Prod: guest cancelled 24→28 Oct; Booking kept booked:"1" and added cancelled:"1", room free.
    const m = extractRateNights(
      body([
        { date: '2026-10-25', booked: '1', cancelled: '1', price: '240.0' },
        { date: '2026-10-26', booked: '2', cancelled: '1' }, // re-sold after the cancellation
        { date: '2026-10-27', booked: '1', cancelled: '' }, // no cancelled counter
        { date: '2026-10-28', booked: '1', cancelled: '3' }, // odd counters: never below zero
        { date: '2026-10-29', booked: '', dayBooked: '1', dayCancelled: '1' }, // date-level counters
        { date: '2026-10-30', booked: '', dayBooked: '1', dayCancelled: '0' },
        { date: '2026-10-31', booked: '1', cancelled: '1', availability: '0' }, // no room: booked as sent
        { date: '2026-11-01', booked: '1', cancelled: '1', availability: '' }, // no availability: booked as sent
      ]),
      ROOM,
      RATE,
    );
    expect(m.get('2026-10-25')).toEqual({ date: '2026-10-25', closed: false, price: 240, booked: 0, availability: 1 });
    expect(m.get('2026-10-26')?.booked).toBe(1);
    expect(m.get('2026-10-27')?.booked).toBe(1);
    expect(m.get('2026-10-28')?.booked).toBe(0);
    expect(m.get('2026-10-29')?.booked).toBe(0);
    expect(m.get('2026-10-30')?.booked).toBe(1);
    expect(m.get('2026-10-31')).toMatchObject({ booked: 1, availability: 0 });
    expect(m.get('2026-11-01')).toMatchObject({ booked: 1, availability: null });
  });

  it('activeBookings: booked minus cancelled only while a room is for sale, null without booked', () => {
    expect(activeBookings({ booked: '1', cancelled: '1' }, 1)).toBe(0);
    expect(activeBookings({ booked: 2, cancelled: 1 }, 1)).toBe(1);
    expect(activeBookings({ booked: '1' }, 1)).toBe(1);
    expect(activeBookings({ booked: '1', cancelled: '' }, 1)).toBe(1);
    expect(activeBookings({ booked: '0', cancelled: '2' }, 1)).toBe(0);
    expect(activeBookings({ booked: '1', cancelled: '1' }, 0)).toBe(1);
    expect(activeBookings({ booked: '1', cancelled: '1' }, null)).toBe(1);
    expect(activeBookings({ booked: '', cancelled: '1' }, 1)).toBeNull();
    expect(activeBookings({}, 1)).toBeNull();
  });

  it('survives empty or odd bodies', () => {
    expect(extractRateNights(null, ROOM, RATE).size).toBe(0);
    expect(extractRateNights({ rooms: 'x' }, ROOM, RATE).size).toBe(0);
    expect(extractRateNights({ data: { rooms: [{ id: ROOM, dates: [{ date: 'bad' }] }] } }, ROOM, RATE).size).toBe(0);
  });
});

describe('planCalendarDates — open', () => {
  const base = nights([
    { date: '2026-11-01', closed: true, price: 1180 }, // Sunday
    { date: '2026-11-02', closed: true, price: 1180 }, // Monday
    { date: '2026-11-06', closed: true, price: 1180 }, // Friday
    { date: '2026-11-07', closed: false, price: 1180 }, // Saturday, open already
  ]);

  it('opens a closed night whose only reservation was cancelled', () => {
    const read = extractRateNights(
      body([
        { date: '2026-11-01', closed: '1', price: '1180.0', booked: '1', cancelled: '1' },
        { date: '2026-11-02', closed: '1', price: '1180.0', booked: '1' },
      ]),
      ROOM,
      RATE,
    );
    const p = planCalendarDates(read, { action: 'open', dateFrom: '2026-11-01', dateToExclusive: '2026-11-03' });
    expect(p.changes.map((c) => c.date)).toEqual(['2026-11-01']);
    expect(p.skipped.booked).toBe(1);
  });

  it('does not open a night with a cancelled reservation when Booking sends no availability', () => {
    const read = extractRateNights(
      body([{ date: '2026-11-01', closed: '1', price: '1180.0', booked: '1', cancelled: '1', availability: '' }]),
      ROOM,
      RATE,
    );
    const p = planCalendarDates(read, { action: 'open', dateFrom: '2026-11-01', dateToExclusive: '2026-11-02' });
    expect(p.changes).toEqual([]);
    expect(p.skipped.booked).toBe(1);
  });

  it('keeps each night price when no price is given', () => {
    const p = planCalendarDates(base, { action: 'open', dateFrom: '2026-11-01', dateToExclusive: '2026-11-08' });
    expect(p.nights).toBe(7);
    expect(p.changes.map((c) => [c.date, c.price, c.closed])).toEqual([
      ['2026-11-01', 1180, false],
      ['2026-11-02', 1180, false],
      ['2026-11-06', 1180, false],
    ]);
    expect(p.skipped.missing).toBe(3); // 3rd, 4th, 5th not reported
    expect(p.skipped.unchanged).toBe(1); // 7th already open at that price
  });

  it('sets one price, and re-prices open nights too', () => {
    const p = planCalendarDates(base, { action: 'open', dateFrom: '2026-11-01', dateToExclusive: '2026-11-08', price: 900 });
    expect(p.changes.map((c) => [c.date, c.price])).toEqual([
      ['2026-11-01', 900],
      ['2026-11-02', 900],
      ['2026-11-06', 900],
      ['2026-11-07', 900],
    ]);
    expect(countChanges(p.changes)).toEqual({ open: 3, close: 0, price: 1 });
  });

  it('uses the weekend price on Friday and Saturday nights only', () => {
    const p = planCalendarDates(base, {
      action: 'open',
      dateFrom: '2026-11-01',
      dateToExclusive: '2026-11-08',
      price: 900,
      weekendPrice: 1000,
    });
    expect(Object.fromEntries(p.changes.map((c) => [c.date, c.price]))).toEqual({
      '2026-11-01': 900,
      '2026-11-02': 900,
      '2026-11-06': 1000,
      '2026-11-07': 1000,
    });
  });

  it('touches only the selected days of the week', () => {
    const p = planCalendarDates(base, { action: 'open', dateFrom: '2026-11-01', dateToExclusive: '2026-11-08', weekdays: [0], price: 700 });
    expect(p.changes.map((c) => c.date)).toEqual(['2026-11-01']);
    expect(p.skipped.weekday).toBe(6);
  });

  it('never touches nights booked in RentAI or sold on Booking', () => {
    const n = nights([
      { date: '2026-11-01', closed: true },
      { date: '2026-11-02', closed: true, booked: 1 },
      { date: '2026-11-03', closed: true },
    ]);
    const p = planCalendarDates(
      n,
      { action: 'open', dateFrom: '2026-11-01', dateToExclusive: '2026-11-04', price: 500 },
      { crmBlocked: new Set(['2026-11-01']) },
    );
    expect(p.changes.map((c) => c.date)).toEqual(['2026-11-03']);
    expect(p.skipped).toMatchObject({ crm: 1, booked: 1 });
  });

  it('leaves nights with no room for sale (availability 0) alone', () => {
    const p = planCalendarDates(nights([{ date: '2026-11-01', closed: true, availability: 0 }, { date: '2026-11-02', closed: true, availability: null }]), {
      action: 'open',
      dateFrom: '2026-11-01',
      dateToExclusive: '2026-11-03',
    });
    expect(p.changes.map((c) => c.date)).toEqual(['2026-11-02']);
    expect(p.skipped.booked).toBe(1);
  });

  it('«as on Booking» never opens a night below the minimum price', () => {
    const n = nights([
      { date: '2026-11-01', closed: true, price: 100 },
      { date: '2026-11-02', closed: true, price: 300 },
      { date: '2026-11-03', closed: false, price: 100 },
    ]);
    const p = planCalendarDates(n, { action: 'open', dateFrom: '2026-11-01', dateToExclusive: '2026-11-04' }, { minPrice: 300 });
    expect(p.changes.map((c) => c.date)).toEqual(['2026-11-02']);
    expect(p.skipped).toMatchObject({ belowMin: 1, unchanged: 1 });
  });

  it('skips a night without a price when keeping prices', () => {
    const p = planCalendarDates(nights([{ date: '2026-11-01', closed: true, price: null }]), {
      action: 'open',
      dateFrom: '2026-11-01',
      dateToExclusive: '2026-11-02',
    });
    expect(p.changes).toEqual([]);
    expect(p.skipped.noPrice).toBe(1);
  });

  it('treats a price within a cent as unchanged', () => {
    const p = planCalendarDates(nights([{ date: '2026-11-01', closed: false, price: 330 }]), {
      action: 'open',
      dateFrom: '2026-11-01',
      dateToExclusive: '2026-11-02',
      price: 330.001,
    });
    expect(p.changes).toEqual([]);
    expect(p.skipped.unchanged).toBe(1);
  });

  it('rounds the sent price to cents', () => {
    const p = planCalendarDates(nights([{ date: '2026-11-01', closed: true }]), {
      action: 'open',
      dateFrom: '2026-11-01',
      dateToExclusive: '2026-11-02',
      price: 333.333,
    });
    expect(p.changes[0]!.price).toBe(333.33);
  });

  it('auto-extension: opens only closed nights, keeps open ones and the «leave closed» list', () => {
    const n = nights([
      { date: '2026-11-01', closed: true, price: 1180 },
      { date: '2026-11-02', closed: false, price: 400 },
      { date: '2026-11-03', closed: true, price: 1180 },
    ]);
    const p = planCalendarDates(
      n,
      { action: 'open', dateFrom: '2026-11-01', dateToExclusive: '2026-11-04', price: 1000, onlyClosed: true },
      { keepClosed: new Set(['2026-11-03']) },
    );
    expect(p.changes.map((c) => [c.date, c.price])).toEqual([['2026-11-01', 1000]]);
    expect(p.skipped).toMatchObject({ unchanged: 1, keepClosed: 1 });
  });
});

describe('planCalendarDates — close', () => {
  it('closes open nights at their own price and leaves closed ones', () => {
    const n = nights([
      { date: '2026-11-01', closed: false, price: 400 },
      { date: '2026-11-02', closed: true, price: 1180 },
      { date: '2026-11-03', closed: false, price: 420 },
    ]);
    const p = planCalendarDates(n, { action: 'close', dateFrom: '2026-11-01', dateToExclusive: '2026-11-04', price: 1 });
    expect(p.changes.map((c) => [c.date, c.price, c.closed])).toEqual([
      ['2026-11-01', 400, true],
      ['2026-11-03', 420, true],
    ]);
    expect(p.skipped.unchanged).toBe(1);
    expect(p.alreadyClosed).toEqual(['2026-11-02']);
    expect(countChanges(p.changes)).toEqual({ open: 0, close: 2, price: 0 });
  });

  it('closing ignores the minimum price (the price stays as it is)', () => {
    const p = planCalendarDates(nights([{ date: '2026-11-01', closed: false, price: 100 }]), {
      action: 'close',
      dateFrom: '2026-11-01',
      dateToExclusive: '2026-11-02',
    }, { minPrice: 300 });
    expect(p.changes.map((c) => [c.date, c.price, c.closed])).toEqual([['2026-11-01', 100, true]]);
  });

  it('opening never reports «already closed»', () => {
    const p = planCalendarDates(nights([{ date: '2026-11-01', closed: true }]), {
      action: 'open',
      dateFrom: '2026-11-01',
      dateToExclusive: '2026-11-02',
    });
    expect(p.alreadyClosed).toEqual([]);
  });

  it('does not close a sold night (nothing to close) and ignores the «leave closed» list', () => {
    const n = nights([{ date: '2026-11-01', closed: false, booked: 1 }, { date: '2026-11-02', closed: false }]);
    const p = planCalendarDates(
      n,
      { action: 'close', dateFrom: '2026-11-01', dateToExclusive: '2026-11-03' },
      { keepClosed: new Set(['2026-11-02']) },
    );
    expect(p.changes.map((c) => c.date)).toEqual(['2026-11-02']);
  });
});

describe('mergeChangesToRanges', () => {
  const ch = (date: string, price = 1180, closed = false): NightChange => ({ date, price, closed, fromPrice: 1180, fromClosed: true });

  it('joins consecutive nights with the same price and state', () => {
    expect(mergeChangesToRanges([ch('2026-11-02'), ch('2026-11-01'), ch('2026-11-03')])).toEqual([
      { dateFrom: '2026-11-01', dateToExclusive: '2026-11-04', price: 1180, closed: false, nights: 3 },
    ]);
  });

  it('cuts at gaps, price changes and state changes', () => {
    const r = mergeChangesToRanges([
      ch('2026-11-01'),
      ch('2026-11-02', 900),
      ch('2026-11-03', 900, true),
      ch('2026-11-05', 900, true),
    ]);
    expect(r.map((x) => [x.dateFrom, x.dateToExclusive, x.price, x.closed])).toEqual([
      ['2026-11-01', '2026-11-02', 1180, false],
      ['2026-11-02', '2026-11-03', 900, false],
      ['2026-11-03', '2026-11-04', 900, true],
      ['2026-11-05', '2026-11-06', 900, true],
    ]);
  });

  it('keeps every request within 28 nights', () => {
    const many = nightKeys('2026-11-01', '2027-01-30').map((d) => ch(d));
    const r = mergeChangesToRanges(many);
    expect(r.every((x) => x.nights <= MAX_WINDOW_NIGHTS)).toBe(true);
    expect(r.reduce((s, x) => s + x.nights, 0)).toBe(many.length);
    expect(r).toHaveLength(Math.ceil(many.length / MAX_WINDOW_NIGHTS));
  });

  it('weekday / weekend prices over a week → 2–3 requests per week', () => {
    const n = nights(nightKeys('2026-11-02', '2026-11-09').map((date) => ({ date, closed: true })));
    const p = planCalendarDates(n, { action: 'open', dateFrom: '2026-11-02', dateToExclusive: '2026-11-09', price: 900, weekendPrice: 1000 });
    const r = mergeChangesToRanges(p.changes);
    expect(r.map((x) => [x.dateFrom, x.dateToExclusive, x.price])).toEqual([
      ['2026-11-02', '2026-11-06', 900],
      ['2026-11-06', '2026-11-08', 1000],
      ['2026-11-08', '2026-11-09', 900],
    ]);
  });

  it('returns nothing for nothing', () => {
    expect(mergeChangesToRanges([])).toEqual([]);
  });
});

describe('findMismatches', () => {
  const sent: NightChange[] = [
    { date: '2026-11-01', price: 1180, closed: false, fromPrice: 1180, fromClosed: true },
    { date: '2026-11-02', price: 900, closed: false, fromPrice: 1180, fromClosed: true },
    { date: '2026-11-03', price: 900, closed: false, fromPrice: 1180, fromClosed: true },
  ];

  it('lists nights Booking reports differently or not at all', () => {
    const after = nights([
      { date: '2026-11-01', closed: false, price: 1180 },
      { date: '2026-11-02', closed: true, price: 900 },
    ]);
    expect(findMismatches(sent, after)).toEqual(['2026-11-02', '2026-11-03']);
  });

  it('accepts a price Booking rounded within a cent', () => {
    const after = nights(sent.map((c) => ({ date: c.date, closed: false, price: c.price + 0.001 })));
    expect(findMismatches(sent, after)).toEqual([]);
  });
});

describe('findMismatches — price only', () => {
  it('a price run compares the price, not the state', () => {
    const change = { date: '2026-11-01', price: 520, closed: false, fromPrice: 500, fromClosed: false };
    const after = new Map([['2026-11-01', { date: '2026-11-01', closed: true, price: 520, booked: 0 }]]);
    expect(findMismatches([change], after)).toEqual(['2026-11-01']);
    expect(findMismatches([change], after, { priceOnly: true })).toEqual([]);
    const wrong = new Map([['2026-11-01', { date: '2026-11-01', closed: false, price: 500, booked: 0 }]]);
    expect(findMismatches([change], wrong, { priceOnly: true })).toEqual(['2026-11-01']);
  });
});

describe('planPriceTargets', () => {
  const night = (date: string, over: Partial<RateNight> = {}): RateNight => ({ date, closed: false, price: 500, booked: 0, availability: 1, ...over });
  const nights = (list: RateNight[]) => new Map(list.map((n) => [n.date, n]));

  it('re-prices open nights only; a closed night is left alone and counted', () => {
    const plan = planPriceTargets(
      nights([night('2026-11-01'), night('2026-11-02', { closed: true, price: 1180 })]),
      new Map([['2026-11-01', 520], ['2026-11-02', 520]]),
    );
    expect(plan.changes).toEqual([{ date: '2026-11-01', price: 520, closed: false, fromPrice: 500, fromClosed: false }]);
    expect(plan.skipped.closed).toBe(1);
    expect(countChanges(plan.changes)).toEqual({ open: 0, close: 0, price: 1 });
  });

  it('re-prices a night whose only reservation was cancelled; a re-sold or full night stays skipped', () => {
    const read = extractRateNights(
      body([
        { date: '2026-10-25', booked: '1', cancelled: '1', price: '240.0' },
        { date: '2026-10-26', booked: '2', cancelled: '1', price: '240.0' },
        { date: '2026-10-27', booked: '1', cancelled: '1', price: '290.0', availability: '0' },
      ]),
      ROOM,
      RATE,
    );
    const plan = planPriceTargets(read, new Map([['2026-10-25', 250], ['2026-10-26', 250], ['2026-10-27', 270]]));
    expect(plan.changes).toEqual([{ date: '2026-10-25', price: 250, closed: false, fromPrice: 240, fromClosed: false }]);
    expect(plan.skipped.booked).toBe(2);
  });

  it('a sold closed night counts as sold, not closed', () => {
    const plan = planPriceTargets(nights([night('2026-11-01', { closed: true, booked: 1 })]), new Map([['2026-11-01', 520]]));
    expect(plan.skipped).toMatchObject({ booked: 1, closed: 0 });
  });

  it('skips: same price, sold, no room, RentAI booking, missing, below the minimum, no price', () => {
    const plan = planPriceTargets(
      nights([
        night('2026-11-01'),
        night('2026-11-02', { booked: 1 }),
        night('2026-11-03', { availability: 0 }),
        night('2026-11-04'),
        night('2026-11-06'),
        night('2026-11-07'),
      ]),
      new Map([
        ['2026-11-01', 500],
        ['2026-11-02', 600],
        ['2026-11-03', 600],
        ['2026-11-04', 600],
        ['2026-11-05', 600],
        ['2026-11-06', 100],
        ['2026-11-07', Number.NaN],
      ]),
      { crmBlocked: new Set(['2026-11-04']), minPrice: 160 },
    );
    expect(plan.changes).toEqual([]);
    expect(plan.nights).toBe(7);
    expect(plan.skipped).toMatchObject({ unchanged: 1, booked: 2, crm: 1, missing: 1, belowMin: 1, noPrice: 1 });
  });

  it('a minimum equal to the price is allowed; nights without a target are not looked at', () => {
    const plan = planPriceTargets(nights([night('2026-11-01'), night('2026-11-02')]), new Map([['2026-11-01', 160]]), { minPrice: 160 });
    expect(plan.changes.map((c) => c.date)).toEqual(['2026-11-01']);
    expect(plan.nights).toBe(1);
  });

  it('runs of the same price and state merge into one request each', () => {
    const plan = planPriceTargets(
      nights(nightKeys('2026-11-01', '2026-11-05').map((d) => night(d))),
      new Map([['2026-11-01', 520], ['2026-11-02', 520], ['2026-11-03', 550], ['2026-11-04', 550]]),
    );
    expect(mergeChangesToRanges(plan.changes).map((r) => [r.dateFrom, r.dateToExclusive, r.price])).toEqual([
      ['2026-11-01', '2026-11-03', 520],
      ['2026-11-03', '2026-11-05', 550],
    ]);
  });
});
