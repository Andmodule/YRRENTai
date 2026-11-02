import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { channelPriceNow } from './ota-price-now';

describe('channelPriceNow', () => {
  it('one night with a price', () => {
    assert.deepEqual(channelPriceNow({ '2026-11-09': 320 }, '2026-11-09', '2026-11-10'), {
      min: 320,
      max: 320,
      unknown: 0,
      nights: 1,
    });
  });

  it('several nights: lowest and highest', () => {
    const prices = { '2026-11-09': 320, '2026-11-10': 280, '2026-11-11': 350 };
    assert.deepEqual(channelPriceNow(prices, '2026-11-09', '2026-11-12'), { min: 280, max: 350, unknown: 0, nights: 3 });
  });

  it('nights without a price are counted, not taken as zero', () => {
    const prices = { '2026-11-09': 320, '2026-11-10': 0 };
    assert.deepEqual(channelPriceNow(prices, '2026-11-09', '2026-11-12'), { min: 320, max: 320, unknown: 2, nights: 3 });
  });

  it('no prices at all (property not read from the channel yet)', () => {
    assert.deepEqual(channelPriceNow(undefined, '2026-11-09', '2026-11-11'), { min: null, max: null, unknown: 2, nights: 2 });
  });

  it('empty or reversed range gives nothing', () => {
    assert.equal(channelPriceNow({ '2026-11-09': 320 }, '2026-11-09', '2026-11-09').nights, 0);
    assert.equal(channelPriceNow({ '2026-11-09': 320 }, '2026-11-10', '2026-11-09').nights, 0);
    assert.equal(channelPriceNow({ '2026-11-09': 320 }, '', '2026-11-10').nights, 0);
  });

  it('crosses a month and the October clock change', () => {
    const prices = { '2026-10-24': 300, '2026-10-25': 310, '2026-10-26': 290, '2026-10-31': 400, '2026-11-01': 410 };
    assert.deepEqual(channelPriceNow(prices, '2026-10-24', '2026-10-27'), { min: 290, max: 310, unknown: 0, nights: 3 });
    assert.deepEqual(channelPriceNow(prices, '2026-10-31', '2026-11-02'), { min: 400, max: 410, unknown: 0, nights: 2 });
  });

  it('a mistyped far year stops at a year of nights', () => {
    assert.equal(channelPriceNow({}, '2026-11-09', '2126-11-09').nights, 366);
  });
});
