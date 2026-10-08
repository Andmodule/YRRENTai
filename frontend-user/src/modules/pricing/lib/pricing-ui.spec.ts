import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDaysYmd,
  campaignHealth,
  cellPrice,
  guestPrice,
  isBelowMin,
  isNotSent,
  isTargetingType,
  nightsCount,
  normalizeWeekdays,
  presetRange,
  promotionsForCell,
  safeDiscountPct,
  stayNights,
  weekdayOf,
} from './pricing-ui.js';
import type { CalendarPromotion } from '../api.js';
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
