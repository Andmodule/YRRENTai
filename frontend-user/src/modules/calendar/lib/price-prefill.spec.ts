import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { basePrefill, prefillText, samePrice } from './price-prefill';

describe('samePrice', () => {
  it('one value for every night', () => {
    assert.equal(samePrice([240, 240, 240]), 240);
  });
  it('different values, a missing one, or nothing picked → empty', () => {
    assert.equal(samePrice([240, 250]), null);
    assert.equal(samePrice([240, null]), null);
    assert.equal(samePrice([undefined, 240]), null);
    assert.equal(samePrice([]), null);
  });
  it('zero or negative is not a price', () => {
    assert.equal(samePrice([0, 0]), null);
    assert.equal(samePrice([-5]), null);
  });
});

describe('basePrefill', () => {
  const nights = [
    { ymd: '2026-11-16', rack: 240 },
    { ymd: '2026-11-17', rack: 240 },
  ];
  it('the shared base price', () => {
    assert.equal(basePrefill(nights, { '2026-11-16': 220, '2026-11-17': 220 }), 220);
  });
  it('no base price yet → what Booking has now', () => {
    assert.equal(basePrefill(nights, {}), 240);
  });
  it('base on some nights only → empty (never mixes base and Booking)', () => {
    assert.equal(basePrefill(nights, { '2026-11-16': 220 }), null);
  });
  it('different base prices, or Booking prices that differ / are missing → empty', () => {
    assert.equal(basePrefill(nights, { '2026-11-16': 220, '2026-11-17': 230 }), null);
    assert.equal(basePrefill([{ ymd: 'a', rack: 240 }, { ymd: 'b', rack: 250 }], {}), null);
    assert.equal(basePrefill([{ ymd: 'a', rack: null }], {}), null);
  });
});

describe('prefillText', () => {
  it('whole, decimal and empty', () => {
    assert.equal(prefillText(240), '240');
    assert.equal(prefillText(197.955), '197.96');
    assert.equal(prefillText(null), '');
  });
});
