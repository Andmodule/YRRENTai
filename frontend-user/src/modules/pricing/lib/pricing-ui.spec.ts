import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDaysYmd,
  guestPrice,
  isBelowMin,
  nightsCount,
  normalizeWeekdays,
  presetRange,
  promotionsForCell,
  safeDiscountPct,
  weekdayOf,
} from './pricing-ui.js';
import type { CalendarPromotion } from '../api.js';

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
