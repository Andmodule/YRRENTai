import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_RANGE_NIGHTS,
  RANGE_PRESETS,
  buildDatesRequest,
  estimateParts,
  parsePrice,
  presetLastNight,
  requestKey,
  skippedList,
  type DatesFormState,
} from './calendar-dates';
import { WEEKDAYS, addDaysYmd } from '../../pricing/lib/pricing-ui';

const TODAY = '2026-10-12';

function form(over: Partial<DatesFormState> = {}): DatesFormState {
  return {
    propertyId: 'p1',
    action: 'open',
    from: '2026-11-01',
    to: '2026-11-30',
    weekdays: new Set(WEEKDAYS),
    priceMode: 'keep',
    price: '',
    weekendPrice: '',
    repriceOpen: false,
    ...over,
  };
}

describe('presetLastNight', () => {
  it('counts the first night in', () => {
    assert.equal(presetLastNight('2026-11-01', 3), '2026-11-03');
    assert.equal(presetLastNight('2026-11-01', 90), '2027-01-29');
    assert.equal(presetLastNight('2026-11-01', 365), '2027-10-31');
    assert.deepEqual([...RANGE_PRESETS], [3, 30, 60, 90, 365]);
  });
});

describe('parsePrice', () => {
  it('reads spaces, commas and dots', () => {
    assert.equal(parsePrice('1180'), 1180);
    assert.equal(parsePrice(' 1 180 '), 1180);
    assert.equal(parsePrice('900,5'), 900.5);
    assert.equal(parsePrice('900.555'), 900.56);
  });
  it('refuses empty, zero, negative and junk', () => {
    for (const v of ['', '0', '0,00', '-5', 'abc', '12a', '1.2.3']) assert.equal(parsePrice(v), null, v);
  });
});

describe('buildDatesRequest', () => {
  it('open, keeping prices: no price, all days, exclusive end', () => {
    const r = buildDatesRequest(form(), TODAY);
    assert.deepEqual(r, {
      ok: true,
      body: { propertyId: 'p1', action: 'open', dateFrom: '2026-11-01', dateTo: '2026-12-01' },
    });
  });

  it('open with one price: only closed nights unless open ones are re-priced too', () => {
    const r = buildDatesRequest(form({ priceMode: 'one', price: '1180' }), TODAY);
    assert.ok(r.ok);
    assert.equal(r.body.price, 1180);
    assert.equal(r.body.weekendPrice, undefined);
    assert.equal(r.body.onlyClosed, true);
    const all = buildDatesRequest(form({ priceMode: 'one', price: '1180', repriceOpen: true }), TODAY);
    assert.ok(all.ok);
    assert.equal(all.body.onlyClosed, undefined);
  });

  it('keeping prices or closing never sends «only closed»', () => {
    const keep = buildDatesRequest(form({ repriceOpen: false }), TODAY);
    const close = buildDatesRequest(form({ action: 'close', priceMode: 'one', price: '5' }), TODAY);
    assert.ok(keep.ok && close.ok);
    assert.equal(keep.body.onlyClosed, undefined);
    assert.equal(close.body.onlyClosed, undefined);
  });

  it('open with weekday and weekend prices', () => {
    const r = buildDatesRequest(form({ priceMode: 'split', price: '900', weekendPrice: '1000' }), TODAY);
    assert.ok(r.ok);
    assert.equal(r.body.price, 900);
    assert.equal(r.body.weekendPrice, 1000);
  });

  it('close never sends a price, whatever was typed', () => {
    const r = buildDatesRequest(form({ action: 'close', priceMode: 'split', price: '900', weekendPrice: '1000' }), TODAY);
    assert.ok(r.ok);
    assert.equal(r.body.price, undefined);
    assert.equal(r.body.weekendPrice, undefined);
  });

  it('sends picked days as numbers (Sunday = 0), sorted', () => {
    const r = buildDatesRequest(form({ weekdays: new Set(['Sun', 'Fri', 'Mon'] as const) }), TODAY);
    assert.ok(r.ok);
    assert.deepEqual(r.body.weekdays, [0, 1, 5]);
  });

  it('one night: from = to', () => {
    const r = buildDatesRequest(form({ from: '2026-11-01', to: '2026-11-01' }), TODAY);
    assert.ok(r.ok);
    assert.equal(r.body.dateTo, '2026-11-02');
  });

  it('today is allowed, yesterday is not', () => {
    assert.ok(buildDatesRequest(form({ from: TODAY }), TODAY).ok);
    assert.deepEqual(buildDatesRequest(form({ from: '2026-10-11' }), TODAY), { ok: false, error: 'past' });
  });

  it('366 nights are allowed, 367 are not', () => {
    assert.ok(buildDatesRequest(form({ to: addDaysYmd('2026-11-01', MAX_RANGE_NIGHTS - 1) }), TODAY).ok);
    assert.deepEqual(buildDatesRequest(form({ to: addDaysYmd('2026-11-01', MAX_RANGE_NIGHTS) }), TODAY), { ok: false, error: 'tooLong' });
  });

  it('names what is missing', () => {
    assert.deepEqual(buildDatesRequest(form({ propertyId: '' }), TODAY), { ok: false, error: 'property' });
    assert.deepEqual(buildDatesRequest(form({ to: '2026-10-31' }), TODAY), { ok: false, error: 'dates' });
    assert.deepEqual(buildDatesRequest(form({ to: '' }), TODAY), { ok: false, error: 'dates' });
    assert.deepEqual(buildDatesRequest(form({ weekdays: new Set() }), TODAY), { ok: false, error: 'weekdays' });
    assert.deepEqual(buildDatesRequest(form({ priceMode: 'one', price: '' }), TODAY), { ok: false, error: 'price' });
    assert.deepEqual(buildDatesRequest(form({ priceMode: 'split', price: '900', weekendPrice: '0' }), TODAY), {
      ok: false,
      error: 'weekendPrice',
    });
  });
});

describe('requestKey', () => {
  it('changes with anything that changes the request', () => {
    const a = buildDatesRequest(form({ priceMode: 'one', price: '1180' }), TODAY);
    const b = buildDatesRequest(form({ priceMode: 'one', price: '1180.00' }), TODAY);
    const c = buildDatesRequest(form({ priceMode: 'one', price: '1181' }), TODAY);
    const d = buildDatesRequest(form({ priceMode: 'one', price: '1180', repriceOpen: true }), TODAY);
    assert.ok(a.ok && b.ok && c.ok && d.ok);
    assert.equal(requestKey(a.body), requestKey(b.body));
    assert.notEqual(requestKey(a.body), requestKey(c.body));
    assert.notEqual(requestKey(a.body), requestKey(d.body));
  });
});

describe('skippedList', () => {
  it('keeps only non-zero reasons, sold and RentAI bookings first', () => {
    assert.deepEqual(skippedList({ missing: 1, crm: 2, booked: 3, unchanged: 0 }), [
      ['booked', 3],
      ['crm', 2],
      ['missing', 1],
    ]);
    assert.deepEqual(skippedList({}), []);
  });
});

describe('estimateParts', () => {
  it('seconds under a minute (at least 5), whole minutes above', () => {
    assert.deepEqual(estimateParts(1), { unit: 'sec', value: 5 });
    assert.deepEqual(estimateParts(21), { unit: 'sec', value: 25 });
    assert.deepEqual(estimateParts(60), { unit: 'min', value: 1 });
    assert.deepEqual(estimateParts(61), { unit: 'min', value: 2 });
  });
});
