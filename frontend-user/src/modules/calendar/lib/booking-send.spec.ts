import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sentNightPrices } from './booking-send';

const done = { state: 'done' as const, failed: [], verify: { checked: 3, mismatched: [] as string[] } };
const range = (dateFrom: string, dateToExclusive: string, price: number, closed = false) => ({ dateFrom, dateToExclusive, price, closed });

describe('sentNightPrices', () => {
  it('gives nothing while the run is still sending', () => {
    assert.deepEqual(sentNightPrices({ ...done, state: 'running' }, [range('2026-10-27', '2026-10-28', 245)]), {});
  });

  it('gives nothing for a run that failed as a whole', () => {
    assert.deepEqual(sentNightPrices({ ...done, state: 'failed' }, [range('2026-10-27', '2026-10-28', 245)]), {});
  });

  it('gives the price of a one-night send', () => {
    assert.deepEqual(sentNightPrices(done, [range('2026-10-27', '2026-10-28', 245)]), { '2026-10-27': 245 });
  });

  it('spreads a range over each of its nights, across a month end', () => {
    assert.deepEqual(sentNightPrices(done, [range('2026-10-30', '2026-11-02', 300)]), {
      '2026-10-30': 300,
      '2026-10-31': 300,
      '2026-11-01': 300,
    });
  });

  it('keeps each range at its own price', () => {
    assert.deepEqual(sentNightPrices(done, [range('2026-10-26', '2026-10-27', 250), range('2026-10-27', '2026-10-28', 270)]), {
      '2026-10-26': 250,
      '2026-10-27': 270,
    });
  });

  it('leaves out nights the check after sending found different', () => {
    const job = { ...done, verify: { checked: 3, mismatched: ['2026-10-28'] } };
    assert.deepEqual(sentNightPrices(job, [range('2026-10-27', '2026-10-30', 245)]), {
      '2026-10-27': 245,
      '2026-10-29': 245,
    });
  });

  it('leaves out a range Booking refused in a finished run', () => {
    const job = {
      state: 'done' as const,
      failed: [{ dateFrom: '2026-10-28', dateToExclusive: '2026-10-30', detail: '500' }],
      verify: { checked: 1, mismatched: [] },
    };
    assert.deepEqual(sentNightPrices(job, [range('2026-10-27', '2026-10-28', 245), range('2026-10-28', '2026-10-30', 260)]), {
      '2026-10-27': 245,
    });
  });

  it('gives nothing for a stopped run — ranges after the stop are not listed as failed', () => {
    const job = {
      state: 'stopped' as const,
      failed: [{ dateFrom: '2026-10-28', dateToExclusive: '2026-10-29', detail: '500' }],
      verify: { checked: 1, mismatched: [] },
    };
    assert.deepEqual(sentNightPrices(job, [range('2026-10-27', '2026-10-28', 245), range('2026-10-29', '2026-10-30', 260)]), {});
  });

  it('uses the sent prices when the check could not read Booking', () => {
    const job = { state: 'done' as const, failed: [], verify: { checked: 0, mismatched: [], error: 'timeout' } };
    assert.deepEqual(sentNightPrices(job, [range('2026-10-27', '2026-10-28', 245)]), { '2026-10-27': 245 });
  });

  it('works without a check result', () => {
    assert.deepEqual(sentNightPrices({ state: 'done', failed: [], verify: null }, [range('2026-10-27', '2026-10-28', 245)]), {
      '2026-10-27': 245,
    });
  });

  it('skips closing ranges — they carry no price', () => {
    assert.deepEqual(sentNightPrices(done, [range('2026-10-27', '2026-10-29', 0, true)]), {});
  });

  it('gives nothing for no ranges', () => {
    assert.deepEqual(sentNightPrices(done, []), {});
  });
});
