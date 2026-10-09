import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDaysYmd,
  campaignHealth,
  cellKey,
  cellPrice,
  cellPriceLabels,
  findShadowedSteps,
  guestPrice,
  hourlyLadder,
  hoursBefore,
  isBelowMin,
  isBookTimeNow,
  isNotSent,
  isRuleStep,
  isTargetingType,
  MAX_RULE_STEPS,
  nightsCount,
  normalizeWeekdays,
  occupancyAction,
  parseOccupancyDraft,
  presetRange,
  promotionsForCell,
  ruleTemplate,
  safeDiscountPct,
  sortSteps,
  stayNights,
  timeWindowKey,
  weekdayOf,
} from './pricing-ui.js';
import type { CalendarPromotion, RuleStepInput } from '../api.js';
import type { CellPromotion } from './pricing-ui.js';

describe('dates', () => {
  it('weekdays and inclusive nights', () => {
    assert.equal(weekdayOf('2026-10-04'), 'Sun');
    assert.equal(weekdayOf('2026-10-10'), 'Sat');
    assert.equal(nightsCount('2026-10-05', '2026-10-11'), 7);
    assert.equal(addDaysYmd('2026-10-31', 1), '2026-11-01');
  });

  it('quick presets', () => {
    assert.deepEqual(presetRange('today', '2026-10-05'), { from: '2026-10-05', to: '2026-10-05' });
    assert.deepEqual(presetRange('week', '2026-10-05'), { from: '2026-10-05', to: '2026-10-11' });
    // Monday → coming Saturday + Sunday; Saturday → today + tomorrow; Sunday → today only
    assert.deepEqual(presetRange('weekend', '2026-10-05'), { from: '2026-10-10', to: '2026-10-11' });
    assert.deepEqual(presetRange('weekend', '2026-10-10'), { from: '2026-10-10', to: '2026-10-11' });
    assert.deepEqual(presetRange('weekend', '2026-10-11'), { from: '2026-10-11', to: '2026-10-11' });
  });

  it('weekday filter: all or none = every day', () => {
    assert.equal(normalizeWeekdays(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']), null);
    assert.equal(normalizeWeekdays([]), null);
    assert.deepEqual(normalizeWeekdays(['Sun', 'Sat']), ['Sat', 'Sun']);
  });
});

describe('Genius-aware prices', () => {
  it('Genius first, then the deal', () => {
    assert.ok(Math.abs(guestPrice(420, 10, 10) - 340.2) < 1e-9);
    assert.equal(guestPrice(420, 10, null), 378);
  });

  it('safe discount and minimum price agree', () => {
    assert.equal(safeDiscountPct(420, 10, 320), 15);
    assert.equal(safeDiscountPct(290, 10, 240), 8);
    assert.equal(safeDiscountPct(420, 10, null), null);
    assert.equal(isBelowMin(420, 15, 10, 320), false);
    assert.equal(isBelowMin(420, 16, 10, 320), true);
  });

  it('a Mobile / Country rate stacks on top (300 → 270 → 243 → 218.7)', () => {
    assert.ok(Math.abs(guestPrice(300, 10, 10, 10) - 218.7) < 1e-9);
    assert.equal(guestPrice(300, 10, 10, null), 243);
    assert.equal(isBelowMin(300, 10, 10, 230), false);
    assert.equal(isBelowMin(300, 10, 10, 230, 10), true);
    assert.equal(safeDiscountPct(300, 10, 230), 14);
    assert.equal(safeDiscountPct(300, 10, 230, 10), 5);
    assert.equal(isBelowMin(300, 5, 10, 230, 10), false);
    assert.equal(isBelowMin(300, 6, 10, 230, 10), true);
  });
});

describe('cellPrice — the price printed in a calendar cell', () => {
  const promo = (over: Partial<CellPromotion>): CellPromotion => ({
    id: 'p', name: 'Осень', discountPct: 10, source: 'rentai', promotionType: 'basic', state: 'on', confirmed: true, errorCode: null, ...over,
  });

  it('no discount → the rack price, nothing struck through', () => {
    assert.deepEqual(cellPrice(290, []), { price: 290, rack: null });
    assert.deepEqual(cellPrice(220.5, []), { price: 221, rack: null });
  });

  it('no price known → nothing to print', () => {
    for (const rack of [null, undefined, 0, -5, Number.NaN]) assert.equal(cellPrice(rack, [promo({})]), null);
  });

  it('a discount that is really on Booking → the guest price next to the struck rack price', () => {
    assert.deepEqual(cellPrice(290, [promo({})]), { price: 261, rack: 290 });
    assert.deepEqual(cellPrice(300, [promo({ source: 'booking', discountPct: 12 })]), { price: 264, rack: 300 });
  });

  it('only the largest live discount counts (they never add up)', () => {
    const sorted = [promo({ id: 'big', discountPct: 20 }), promo({ id: 'small', discountPct: 5 })];
    assert.deepEqual(cellPrice(300, sorted), { price: 240, rack: 300 });
  });

  it('queued, test-mode, unconfirmed and not-sent discounts leave the price as it is', () => {
    for (const p of [
      promo({ state: 'pending', confirmed: false }),
      promo({ state: 'dry_run', confirmed: false }),
      promo({ state: 'on', confirmed: false }),
      promo({ state: 'skipped', confirmed: false, errorCode: 'NOT_IN_ALLOWLIST' }),
      promo({ state: 'error', confirmed: false, errorCode: 'RATES_INVALID' }),
    ]) {
      assert.deepEqual(cellPrice(290, [p]), { price: 290, rack: null }, p.state);
    }
    // …and do not hide a smaller discount that is live.
    assert.deepEqual(cellPrice(290, [promo({ id: 'q', discountPct: 30, state: 'pending', confirmed: false }), promo({})]), { price: 261, rack: 290 });
  });

  it('a Mobile / Country rate is not the price of the night', () => {
    assert.deepEqual(cellPrice(290, [promo({ promotionType: 'mobile_rate', source: 'booking' })]), { price: 290, rack: null });
    assert.equal(isTargetingType('geo_rate'), true);
    assert.equal(isTargetingType('last_minute'), false);
    assert.equal(isTargetingType(null), false);
  });
});

describe('cellPriceLabels — every night with a Booking price gets one', () => {
  const live: CalendarPromotion = {
    id: 'p1', name: 'Осень', source: 'booking', promotionType: 'basic', discountPct: 10, from: '2026-10-08', to: '2026-10-31', activeWeekdays: null,
    properties: [{ propertyId: 'a', state: 'on', confirmed: true, errorCode: null }],
  };
  const base = {
    propertyIds: ['x', 'a'],
    firstDay: '2026-10-08',
    numDays: 4,
    byProperty: new Map([['a', { '2026-10-08': 300, '2026-10-09': 270, '2026-10-10': 268.4 }]]),
    busy: new Set([cellKey('a', '2026-10-09')]),
    halfBusy: new Set([cellKey('a', '2026-10-10')]),
    promotions: [live],
    narrow: false,
  };
  const short = (l: ReturnType<typeof cellPriceLabels>) => l.map((x) => [x.row, x.day, x.price, x.rack, x.booked, x.compact]);

  it('free night: guest price + struck rack; booked night: the rack price of the date, alone', () => {
    assert.deepEqual(short(cellPriceLabels(base)), [
      [1, 0, 270, 300, false, false], // free, discount on
      [1, 1, 270, null, true, true], // booked: rack 270, no discount maths, single number
      [1, 2, 242, 268, false, true], // check-out day: half the cell is under a bar → compact
      // 2026-10-11 has no price → no label; property «x» has no Booking prices at all
    ]);
  });

  it('a booked night is printed even without any discount around', () => {
    assert.deepEqual(short(cellPriceLabels({ ...base, promotions: [] })), [
      [1, 0, 300, null, false, false],
      [1, 1, 270, null, true, true],
      [1, 2, 268, null, false, true],
    ]);
  });

  it('narrow columns make every label compact', () => {
    assert.ok(cellPriceLabels({ ...base, narrow: true }).every((x) => x.compact));
  });

  it('keys match the busy sets', () => {
    assert.deepEqual(cellPriceLabels(base).map((x) => x.key), ['a:2026-10-08', 'a:2026-10-09', 'a:2026-10-10']);
  });
});

describe('hourlyLadder — «каждые N часов на Y%»', () => {
  const base = { unit: 'hour' as const, value: 12, fromHour: 8, toHour: 22, everyHours: 1, startPct: 5, stepPct: 1 };
  const short = (steps: RuleStepInput[]) => steps.map((s) => `${s.bookTime!.start}-${s.bookTime!.end}:${s.discountPct}`);

  it('every hour +1%: one step per hour, back to back, growing', () => {
    const steps = hourlyLadder(base);
    assert.equal(steps.length, 14);
    assert.deepEqual(short(steps).slice(0, 3), ['8-9:5', '9-10:6', '10-11:7']);
    assert.equal(short(steps).at(-1), '21-22:18');
    assert.ok(steps.every((s) => s.unit === 'hour' && s.value === 12));
    // the slots do not overlap, so no step hides another
    assert.deepEqual(findShadowedSteps(steps), []);
  });

  it('a wider slot: the last one is cut at the end hour', () => {
    assert.deepEqual(short(hourlyLadder({ ...base, fromHour: 9, toHour: 20, everyHours: 4, startPct: 10, stepPct: 5 })), ['9-13:10', '13-17:15', '17-20:20']);
  });

  it('a whole day fits the step limit', () => {
    const day = hourlyLadder({ ...base, fromHour: 0, toHour: 24 });
    assert.equal(day.length, 24);
    assert.ok(day.length <= MAX_RULE_STEPS);
  });

  it('stops at 99% instead of sending a discount Booking refuses', () => {
    const steps = hourlyLadder({ ...base, startPct: 95, stepPct: 2 });
    assert.deepEqual(steps.map((s) => s.discountPct), [95, 97, 99]);
  });

  it('unusable input gives no steps', () => {
    for (const bad of [
      { fromHour: 12, toHour: 12 },
      { fromHour: 20, toHour: 8 },
      { fromHour: -1 },
      { toHour: 25 },
      { everyHours: 0 },
      { everyHours: 0.5 }, // half an hour does not exist for Booking
      { stepPct: 0 },
      { stepPct: 0.5 }, // nor half a percent in this integration
      { startPct: 0 },
      { value: 0 },
    ]) {
      assert.deepEqual(hourlyLadder({ ...base, ...bad }), [], JSON.stringify(bad));
    }
  });

  it('a step for the same hours with a bigger all-day discount is flagged as hidden', () => {
    const steps = [{ discountPct: 8, unit: 'day' as const, value: 1, bookTime: null }, ...hourlyLadder({ ...base, toHour: 12 })];
    // 8-9 −5%, 9-10 −6%, 10-11 −7%, 11-12 −8% are all covered by «1 day before, all day −8%»
    assert.deepEqual(findShadowedSteps(steps).map(([hidden]) => hidden), [1, 2, 3, 4]);
  });
});

describe('parseOccupancyDraft — the thresholds editor', () => {
  const tier = (below: string, pct: string, key = `${below}-${pct}`) => ({ key, below, pct });
  const good = [tier('10', '12'), tier('20', '8'), tier('30', '5')];

  it('valid input → settings ready to save, lowest threshold first', () => {
    assert.deepEqual(parseOccupancyDraft('30', [good[2]!, good[0]!, good[1]!]), {
      value: { horizonDays: 30, tiers: [{ belowPct: 10, discountPct: 12 }, { belowPct: 20, discountPct: 8 }, { belowPct: 30, discountPct: 5 }] },
      problem: null,
    });
  });

  it('the edges are accepted', () => {
    assert.equal(parseOccupancyDraft('7', good).problem, null);
    assert.equal(parseOccupancyDraft('120', good).problem, null);
    assert.equal(parseOccupancyDraft('30', [tier('100', '99')]).problem, null);
    assert.equal(parseOccupancyDraft('30', [tier('1', '1')]).problem, null);
    assert.equal(parseOccupancyDraft('30', [tier('10', '7'), tier('20', '7')]).problem, null); // equal discounts
  });

  it('names what is wrong', () => {
    const problem = (h: string, t: Parameters<typeof parseOccupancyDraft>[1]) => parseOccupancyDraft(h, t).problem;
    for (const h of ['', '6', '121', '30.5', 'abc']) assert.equal(problem(h, good), 'horizon', h);
    assert.equal(problem('30', []), 'count');
    assert.equal(problem('30', Array.from({ length: 7 }, (_, i) => tier(String(10 + i), String(20 - i)))), 'count');
    for (const below of ['', '0', '101', '12.5']) assert.equal(problem('30', [tier(below, '5')]), 'threshold', below);
    for (const pct of ['', '0', '100', '7.5']) assert.equal(problem('30', [tier('10', pct)]), 'discount', pct);
    assert.equal(problem('30', [tier('10', '12', 'a'), tier('10', '8', 'b')]), 'duplicate');
    assert.equal(problem('30', [tier('10', '5'), tier('20', '8')]), 'order');
  });

  it('an invalid draft never produces a value', () => {
    assert.equal(parseOccupancyDraft('30', [tier('10', '5'), tier('20', '8')]).value, null);
  });
});

describe('occupancyAction — what a row offers', () => {
  const current = (discountPct: number) => ({ promotionId: 'p', name: 'Basic Deal', discountPct, source: 'booking' as const });

  it('nothing suggested → nothing offered', () => {
    assert.deepEqual(occupancyAction({ suggestedPct: null, current: current(10), blocked: null }), { kind: 'none' });
  });

  it('no discount yet → apply', () => {
    assert.deepEqual(occupancyAction({ suggestedPct: 8, current: null, blocked: null }), { kind: 'apply', pct: 8, currentPct: null });
  });

  it('a smaller discount is on → apply, and say so', () => {
    assert.deepEqual(occupancyAction({ suggestedPct: 8, current: current(5), blocked: null }), { kind: 'apply', pct: 8, currentPct: 5 });
  });

  it('an equal or bigger discount is on → a new one would be invisible, do not offer it', () => {
    assert.deepEqual(occupancyAction({ suggestedPct: 8, current: current(8), blocked: null }), { kind: 'covered', currentPct: 8 });
    assert.deepEqual(occupancyAction({ suggestedPct: 8, current: current(10), blocked: 'NOT_IN_PILOT' }), { kind: 'covered', currentPct: 10 });
  });

  it('already created but not on Booking → point at it instead of creating it again', () => {
    const notSent = { promotionId: 'try', name: 'Заполненность −12%', discountPct: 12 };
    assert.deepEqual(occupancyAction({ suggestedPct: 12, current: null, blocked: null, notSent }), { kind: 'not_sent', pct: 12, promotionId: 'try' });
    // the reason it was not sent is on the discount itself, so this wins over «not in the pilot list»
    assert.deepEqual(occupancyAction({ suggestedPct: 8, current: null, blocked: 'NOT_IN_PILOT', notSent }), { kind: 'not_sent', pct: 12, promotionId: 'try' });
    // a smaller failed attempt does not stand in the way of a bigger suggestion
    assert.deepEqual(occupancyAction({ suggestedPct: 15, current: null, blocked: null, notSent }), { kind: 'apply', pct: 15, currentPct: null });
    // a live discount that is big enough still comes first
    assert.deepEqual(occupancyAction({ suggestedPct: 12, current: current(12), blocked: null, notSent }), { kind: 'covered', currentPct: 12 });
    // an older API without the field behaves as before
    assert.deepEqual(occupancyAction({ suggestedPct: 12, current: null, blocked: null }), { kind: 'apply', pct: 12, currentPct: null });
  });

  it('outside the pilot list or without access → shown, not applicable', () => {
    assert.deepEqual(occupancyAction({ suggestedPct: 12, current: null, blocked: 'NOT_IN_PILOT' }), { kind: 'blocked', pct: 12, reason: 'NOT_IN_PILOT' });
    assert.deepEqual(occupancyAction({ suggestedPct: 12, current: current(5), blocked: 'NO_ACCESS' }), { kind: 'blocked', pct: 12, reason: 'NO_ACCESS' });
  });
});

describe('stayNights', () => {
  it('check-out day is not an occupied night', () => {
    assert.deepEqual(stayNights('2026-10-09', '2026-10-11'), ['2026-10-09', '2026-10-10']);
    assert.deepEqual(stayNights('2026-10-31T14:00:00Z', '2026-11-01T10:00:00Z'), ['2026-10-31']);
  });

  it('same-day or reversed dates occupy nothing', () => {
    assert.deepEqual(stayNights('2026-10-09', '2026-10-09'), []);
    assert.deepEqual(stayNights('2026-10-10', '2026-10-09'), []);
  });
});

describe('campaignHealth', () => {
  const counts = (over: Partial<Record<'pending' | 'on' | 'off' | 'error' | 'skipped' | 'dry_run' | 'unconfirmed', number>>) => {
    const c = { pending: 0, on: 0, off: 0, error: 0, skipped: 0, dry_run: 0, unconfirmed: 0, ...over };
    return { ...c, total: c.pending + c.on + c.off + c.error + c.skipped + c.dry_run };
  };
  const health = (c: ReturnType<typeof counts>, derivedStatus: 'active' | 'finished' | 'off' = 'active', source: 'rentai' | 'booking' = 'rentai') =>
    campaignHealth({ derivedStatus, source, counts: c });

  it('nothing reached Booking → not «Действует»', () => {
    assert.equal(health(counts({ skipped: 1 })), 'not_sent');
    assert.equal(health(counts({ skipped: 2, error: 1, off: 3 })), 'not_sent');
  });

  it('sent everywhere but confirmed nowhere → «не подтверждена»', () => {
    assert.equal(health(counts({ on: 2, unconfirmed: 2, skipped: 1 })), 'unconfirmed');
  });

  it('one confirmed property is enough; queue and test mode are not failures', () => {
    assert.equal(health(counts({ on: 2, unconfirmed: 1, skipped: 3 })), 'ok');
    assert.equal(health(counts({ pending: 1, skipped: 1 })), 'ok');
    assert.equal(health(counts({ on: 1, unconfirmed: 1, pending: 1 })), 'ok');
    assert.equal(health(counts({ dry_run: 2 })), 'ok');
    assert.equal(health(counts({ off: 2 })), 'ok');
  });

  it('only our own active discounts are judged', () => {
    assert.equal(health(counts({ skipped: 1 }), 'finished'), 'ok');
    assert.equal(health(counts({ skipped: 1 }), 'off'), 'ok');
    assert.equal(health(counts({ skipped: 1 }), 'active', 'booking'), 'ok');
  });
});

describe('promotionsForCell', () => {
  const promos: CalendarPromotion[] = [
    { id: 'p1', name: 'Осень', source: 'rentai', promotionType: 'basic', discountPct: 10, from: '2026-10-06', to: '2026-10-12', activeWeekdays: null, properties: [{ propertyId: 'a', state: 'on', confirmed: true, errorCode: null }] },
    { id: 'pB', name: 'Горящее', source: 'booking', promotionType: 'last_minute', discountPct: 15, from: '2026-10-05', to: '2026-10-07', activeWeekdays: null, properties: [{ propertyId: 'a', state: 'on', confirmed: true, errorCode: null }] },
    { id: 'p2', name: 'Выходные', source: 'rentai', promotionType: 'basic', discountPct: 20, from: '2026-10-01', to: '2026-10-31', activeWeekdays: ['Sat', 'Sun'], properties: [{ propertyId: 'a', state: 'pending', confirmed: false, errorCode: null }] },
  ];

  it('orders by discount — the first one is what the guest sees', () => {
    assert.deepEqual(promotionsForCell(promos, 'a', '2026-10-06').map((p) => p.id), ['pB', 'p1']);
    assert.deepEqual(promotionsForCell(promos, 'a', '2026-10-10').map((p) => p.id), ['p2', 'p1']);
  });

  it('a discount that did not reach Booking never counts as what the guest sees', () => {
    const lost: CalendarPromotion = {
      id: 'pX', name: 'Не ушла', source: 'rentai', promotionType: 'basic', discountPct: 30, from: '2026-10-01', to: '2026-10-31', activeWeekdays: null,
      properties: [{ propertyId: 'a', state: 'skipped', confirmed: false, errorCode: 'NOT_IN_ALLOWLIST' }],
    };
    const cell = promotionsForCell([lost, ...promos], 'a', '2026-10-06');
    assert.deepEqual(cell.map((p) => p.id), ['pB', 'p1', 'pX']);
    assert.equal(isNotSent(cell[0]!.state), false);
    assert.deepEqual([cell[2]!.errorCode, cell[2]!.confirmed, isNotSent(cell[2]!.state)], ['NOT_IN_ALLOWLIST', false, true]);
    // Alone on a night it is still listed — as «not sent», not as a live discount.
    assert.deepEqual(promotionsForCell([lost], 'a', '2026-10-20').map((p) => [p.id, isNotSent(p.state)]), [['pX', true]]);
    assert.equal(isNotSent('error'), true);
    assert.equal(isNotSent('dry_run'), false);
  });

  it('respects weekdays, dates and properties', () => {
    assert.deepEqual(promotionsForCell(promos, 'a', '2026-10-13').map((p) => p.id), []);
    assert.deepEqual(promotionsForCell(promos, 'b', '2026-10-06'), []);
  });
});

describe('auto rule ladder', () => {
  const step = (discountPct: number, unit: 'day' | 'hour', value: number, bookTime: RuleStepInput['bookTime'] = null): RuleStepInput => ({
    discountPct,
    unit,
    value,
    bookTime,
  });

  it('counts hours before arrival', () => {
    assert.equal(hoursBefore(step(5, 'day', 3)), 72);
    assert.equal(hoursBefore(step(5, 'hour', 12)), 12);
  });

  it('reads the ladder farthest first, then by time of day', () => {
    const sorted = sortSteps([
      step(12, 'hour', 12, { start: 12, end: 18 }),
      step(8, 'day', 1),
      step(5, 'day', 3),
      step(10, 'hour', 12, { start: 6, end: 12 }),
    ]);
    assert.deepEqual(
      sorted.map((s) => s.discountPct),
      [5, 8, 10, 12],
    );
  });

  it('the manager template is a growing ladder with nothing hidden', () => {
    const t = ruleTemplate();
    assert.equal(t.length, 5);
    assert.deepEqual(
      t.map((s) => s.discountPct),
      [...t.map((s) => s.discountPct)].sort((a, b) => a - b),
    );
    assert.deepEqual(findShadowedSteps(t), []);
    assert.deepEqual(
      t.map((s) => timeWindowKey(s.bookTime)),
      ['any', 'any', 'morning', 'day', 'evening'],
    );
  });

  it('flags a step the guest can never see (a wider step already gives the same or more)', () => {
    // 1 day before at 5 % is hidden by 3 days before at 8 %: the 3-day deal covers those moments too.
    assert.deepEqual(findShadowedSteps([step(8, 'day', 3), step(5, 'day', 1)]), [[1, 0]]);
    // equal discounts: the closer step adds nothing
    assert.deepEqual(findShadowedSteps([step(5, 'day', 3), step(5, 'day', 1)]), [[1, 0]]);
    // a bigger discount closer to arrival is the point of the ladder
    assert.deepEqual(findShadowedSteps([step(5, 'day', 3), step(8, 'day', 1)]), []);
  });

  it('time-of-day windows are compared by the hours they cover', () => {
    const evening = { start: 18, end: 24 };
    // an any-time 12h step at 10 % hides the evening step at 8 % (whatever the order in the list)
    assert.deepEqual(findShadowedSteps([step(10, 'hour', 12), step(8, 'hour', 12, evening)]), [[1, 0]]);
    assert.deepEqual(findShadowedSteps([step(8, 'hour', 12, evening), step(10, 'hour', 12)]), [[0, 1]]);
    // …but an evening step with a BIGGER discount is exactly what a ladder wants
    assert.deepEqual(findShadowedSteps([step(10, 'hour', 12), step(12, 'hour', 12, evening)]), []);
    // separate windows do not hide each other
    assert.deepEqual(
      findShadowedSteps([step(10, 'hour', 12, { start: 6, end: 12 }), step(8, 'hour', 12, evening)]),
      [],
    );
  });

  it('exact duplicates: only the later one is reported', () => {
    assert.deepEqual(findShadowedSteps([step(5, 'day', 1), step(5, 'hour', 24)]), [[1, 0]]);
  });

  it('booking-time window uses the property time zone', () => {
    const t = new Date('2026-10-05T07:30:00Z'); // 09:30 in Warsaw (UTC+2)
    assert.equal(isBookTimeNow({ start: 9, end: 12 }, 'Europe/Warsaw', t), true);
    assert.equal(isBookTimeNow({ start: 9, end: 12 }, 'UTC', t), false);
    assert.equal(isBookTimeNow(null, 'UTC', t), true);
  });

  it('rule steps are told apart from ordinary discounts', () => {
    assert.equal(isRuleStep({ externalMeta: { rule: { groupId: 'g' }, lastMinute: { unit: 'day', value: 1 } } }), true);
    assert.equal(isRuleStep({ externalMeta: { lastMinute: { unit: 'day', value: 2 } } }), false);
    assert.equal(isRuleStep({ externalMeta: null }), false);
  });
});
