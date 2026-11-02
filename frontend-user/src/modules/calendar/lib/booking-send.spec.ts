import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resendRange, sendStatus, sentNightPrices } from './booking-send';

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

const job = (over: Partial<Parameters<typeof sendStatus>[0] & object> = {}) => ({
  state: 'done' as const,
  failed: [] as { dateFrom: string; dateToExclusive: string; detail: string }[],
  verify: { checked: 3, mismatched: [] as string[] } as { checked: number; mismatched: string[]; error?: string } | null,
  total: 2,
  sent: 2,
  startedAt: '2026-11-02T17:55:00Z',
  finishedAt: '2026-11-02T17:56:00Z' as string | null,
  dateFrom: '2026-11-03',
  dateToExclusive: '2026-11-06',
  ...over,
});

describe('sendStatus', () => {
  it('no run yet — nothing to show', () => {
    assert.equal(sendStatus(null), null);
  });

  it('running — counts sent and refused requests', () => {
    assert.deepEqual(
      sendStatus(job({ state: 'running', sent: 1, total: 4, finishedAt: null, verify: null, failed: [{ dateFrom: '2026-11-03', dateToExclusive: '2026-11-04', detail: '500' }] })),
      { kind: 'running', done: 2, total: 4 },
    );
  });

  it('done and checked — ok, at the finish time', () => {
    assert.deepEqual(sendStatus(job()), { kind: 'ok', at: '2026-11-02T17:56:00Z' });
  });

  it('done without a finish time — the start time', () => {
    assert.deepEqual(sendStatus(job({ finishedAt: null })), { kind: 'ok', at: '2026-11-02T17:55:00Z' });
  });

  it('nothing was different on Booking', () => {
    assert.deepEqual(sendStatus(job({ total: 0, sent: 0, verify: null })), { kind: 'nothing', at: '2026-11-02T17:56:00Z' });
  });

  it('sent, the check could not read Booking', () => {
    assert.equal(sendStatus(job({ verify: { checked: 0, mismatched: [], error: 'timeout' } }))?.kind, 'unchecked');
  });

  it('sent, no check result', () => {
    assert.equal(sendStatus(job({ verify: null }))?.kind, 'unchecked');
  });

  it('refused ranges count their nights', () => {
    assert.deepEqual(
      sendStatus(job({ failed: [{ dateFrom: '2026-11-03', dateToExclusive: '2026-11-05', detail: '500' }] })),
      { kind: 'partial', at: '2026-11-02T17:56:00Z', failedNights: 2, mismatched: 0 },
    );
  });

  it('nights different on Booking after sending', () => {
    assert.deepEqual(
      sendStatus(job({ verify: { checked: 3, mismatched: ['2026-11-04'] } })),
      { kind: 'partial', at: '2026-11-02T17:56:00Z', failedNights: 0, mismatched: 1 },
    );
  });

  it('a refused range across a month end', () => {
    const s = sendStatus(job({ failed: [{ dateFrom: '2026-11-30', dateToExclusive: '2026-12-02', detail: '500' }] }));
    assert.equal(s?.kind === 'partial' && s.failedNights, 2);
  });

  it('failed and stopped runs', () => {
    assert.deepEqual(sendStatus(job({ state: 'failed' })), { kind: 'failed', at: '2026-11-02T17:56:00Z' });
    assert.deepEqual(sendStatus(job({ state: 'stopped' })), { kind: 'stopped', at: '2026-11-02T17:56:00Z' });
  });
});

describe('resendRange', () => {
  it('nothing to send again after a clean run, a run with no changes or while running', () => {
    assert.equal(resendRange(job()), null);
    assert.equal(resendRange(job({ total: 0, sent: 0 })), null);
    assert.equal(resendRange(job({ state: 'running' })), null);
    assert.equal(resendRange(null), null);
  });

  it('a broken-off run — its whole range, last night inclusive', () => {
    assert.deepEqual(resendRange(job({ state: 'stopped' })), { from: '2026-11-03', to: '2026-11-05' });
    assert.deepEqual(resendRange(job({ state: 'failed' })), { from: '2026-11-03', to: '2026-11-05' });
  });

  it('a refused range — exactly its nights', () => {
    assert.deepEqual(
      resendRange(job({ failed: [{ dateFrom: '2026-11-04', dateToExclusive: '2026-11-06', detail: '500' }] })),
      { from: '2026-11-04', to: '2026-11-05' },
    );
  });

  it('refused and different nights together — from the first to the last', () => {
    assert.deepEqual(
      resendRange(
        job({
          failed: [{ dateFrom: '2026-11-10', dateToExclusive: '2026-11-11', detail: '500' }],
          verify: { checked: 3, mismatched: ['2026-11-04'] },
        }),
      ),
      { from: '2026-11-04', to: '2026-11-10' },
    );
  });
});
