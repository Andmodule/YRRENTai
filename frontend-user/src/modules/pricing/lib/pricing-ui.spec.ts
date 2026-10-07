import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDaysYmd,
  findShadowedSteps,
  guestPrice,
  hoursBefore,
  isBelowMin,
  isBookTimeNow,
  isRuleStep,
  nightsCount,
  normalizeWeekdays,
  presetRange,
  promotionsForCell,
  ruleTemplate,
  safeDiscountPct,
  sortSteps,
  timeWindowKey,
  weekdayOf,
} from './pricing-ui.js';
import type { CalendarPromotion, RuleStepInput } from '../api.js';

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
});

describe('promotionsForCell', () => {
  const promos: CalendarPromotion[] = [
    { id: 'p1', name: 'Осень', source: 'rentai', promotionType: 'basic', discountPct: 10, from: '2026-10-06', to: '2026-10-12', activeWeekdays: null, properties: [{ propertyId: 'a', state: 'on' }] },
    { id: 'pB', name: 'Горящее', source: 'booking', promotionType: 'last_minute', discountPct: 15, from: '2026-10-05', to: '2026-10-07', activeWeekdays: null, properties: [{ propertyId: 'a', state: 'on' }] },
    { id: 'p2', name: 'Выходные', source: 'rentai', promotionType: 'basic', discountPct: 20, from: '2026-10-01', to: '2026-10-31', activeWeekdays: ['Sat', 'Sun'], properties: [{ propertyId: 'a', state: 'pending' }] },
  ];

  it('orders by discount — the first one is what the guest sees', () => {
    assert.deepEqual(promotionsForCell(promos, 'a', '2026-10-06').map((p) => p.id), ['pB', 'p1']);
    assert.deepEqual(promotionsForCell(promos, 'a', '2026-10-10').map((p) => p.id), ['p2', 'p1']);
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
