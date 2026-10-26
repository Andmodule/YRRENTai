import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import type { Property } from '../types';
import { patchOtaNightlyPricesInCalendarCache } from './calendar-cache';

function prop(uuid: string, prices?: Record<string, number>): Property {
  return { uuid, title: uuid, otaNightlyPrices: prices } as unknown as Property;
}

function client() {
  const qc = new QueryClient();
  qc.setQueryData(['calendar', '2026-10-01', '2026-10-31', 'p1'], { properties: [prop('p1', { '2026-10-27': 250, '2026-10-28': 270 })], reservations: [] });
  qc.setQueryData(['calendar', '2026-10-20', '2026-11-02'], {
    properties: [prop('p1', { '2026-10-27': 250 }), prop('p2', { '2026-10-27': 400 })],
    reservations: [],
  });
  qc.setQueryData(['calendar', 'reservation-search', 'anna'], [{ uuid: 'r1' }]);
  return qc;
}

describe('patchOtaNightlyPricesInCalendarCache', () => {
  it('writes the sent price into every calendar window of the property, keeping its other nights', () => {
    const qc = client();
    patchOtaNightlyPricesInCalendarCache(qc, 'p1', { '2026-10-27': 245 });
    const month = qc.getQueryData<{ properties: Property[] }>(['calendar', '2026-10-01', '2026-10-31', 'p1'])!;
    assert.deepEqual(month.properties[0]!.otaNightlyPrices, { '2026-10-27': 245, '2026-10-28': 270 });
    const grid = qc.getQueryData<{ properties: Property[] }>(['calendar', '2026-10-20', '2026-11-02'])!;
    assert.deepEqual(grid.properties[0]!.otaNightlyPrices, { '2026-10-27': 245 });
  });

  it('leaves other properties alone', () => {
    const qc = client();
    patchOtaNightlyPricesInCalendarCache(qc, 'p1', { '2026-10-27': 245 });
    const grid = qc.getQueryData<{ properties: Property[] }>(['calendar', '2026-10-20', '2026-11-02'])!;
    assert.deepEqual(grid.properties[1]!.otaNightlyPrices, { '2026-10-27': 400 });
  });

  it('adds prices to a property that had none yet', () => {
    const qc = new QueryClient();
    qc.setQueryData(['calendar', 'a', 'b'], { properties: [prop('p1')], reservations: [] });
    patchOtaNightlyPricesInCalendarCache(qc, 'p1', { '2026-10-27': 245 });
    const data = qc.getQueryData<{ properties: Property[] }>(['calendar', 'a', 'b'])!;
    assert.deepEqual(data.properties[0]!.otaNightlyPrices, { '2026-10-27': 245 });
  });

  it('does not touch the booking search results kept under the same key prefix', () => {
    const qc = client();
    patchOtaNightlyPricesInCalendarCache(qc, 'p1', { '2026-10-27': 245 });
    assert.deepEqual(qc.getQueryData(['calendar', 'reservation-search', 'anna']), [{ uuid: 'r1' }]);
  });

  it('changes nothing for no prices', () => {
    const qc = client();
    const before = qc.getQueryData(['calendar', '2026-10-01', '2026-10-31', 'p1']);
    patchOtaNightlyPricesInCalendarCache(qc, 'p1', {});
    assert.equal(qc.getQueryData(['calendar', '2026-10-01', '2026-10-31', 'p1']), before);
  });

  it('changes nothing when the property is not cached', () => {
    const qc = client();
    patchOtaNightlyPricesInCalendarCache(qc, 'p9', { '2026-10-27': 245 });
    const month = qc.getQueryData<{ properties: Property[] }>(['calendar', '2026-10-01', '2026-10-31', 'p1'])!;
    assert.deepEqual(month.properties[0]!.otaNightlyPrices, { '2026-10-27': 250, '2026-10-28': 270 });
  });
});
