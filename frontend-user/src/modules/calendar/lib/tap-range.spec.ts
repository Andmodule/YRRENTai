import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nextTapRange } from './tap-range';

describe('nextTapRange', () => {
  it('first tap picks one night and waits for the second', () => {
    assert.deepEqual(nextTapRange(null, { row: 2, day: 5 }), {
      rect: { r1: 2, r2: 2, d1: 5, d2: 5 },
      anchor: { row: 2, day: 5 },
    });
  });

  it('second tap later in the same row closes the range', () => {
    assert.deepEqual(nextTapRange({ row: 2, day: 5 }, { row: 2, day: 8 }), {
      rect: { r1: 2, r2: 2, d1: 5, d2: 8 },
      anchor: null,
    });
  });

  it('second tap earlier in the row closes the range backwards', () => {
    assert.deepEqual(nextTapRange({ row: 2, day: 5 }, { row: 2, day: 1 }).rect, { r1: 2, r2: 2, d1: 1, d2: 5 });
  });

  it('second tap on the same night keeps one night and ends the pick', () => {
    assert.deepEqual(nextTapRange({ row: 2, day: 5 }, { row: 2, day: 5 }), {
      rect: { r1: 2, r2: 2, d1: 5, d2: 5 },
      anchor: null,
    });
  });

  it('tap in another row starts over there, not across properties', () => {
    assert.deepEqual(nextTapRange({ row: 2, day: 5 }, { row: 4, day: 7 }), {
      rect: { r1: 4, r2: 4, d1: 7, d2: 7 },
      anchor: { row: 4, day: 7 },
    });
  });

  it('first and last column of the window', () => {
    assert.deepEqual(nextTapRange({ row: 0, day: 0 }, { row: 0, day: 13 }).rect, { r1: 0, r2: 0, d1: 0, d2: 13 });
  });
});
