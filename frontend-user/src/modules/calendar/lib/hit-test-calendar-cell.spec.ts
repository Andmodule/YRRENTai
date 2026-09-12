import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hitTestCalendarCell } from './hit-test-calendar-cell.js';

const ROW = 64;
const DAY = 96;

describe('hitTestCalendarCell', () => {
  it('maps first row when coords are content-relative (header is sibling)', () => {
    const hit = hitTestCalendarCell({
      yInContent: ROW / 2,
      xInContent: DAY * 0.5,
      headerHeightPx: 0,
      itemHeightPx: ROW,
      dayColWidthPx: DAY,
      numDays: 14,
      numRows: 5,
    });
    assert.equal(hit.kind, 'cell');
    if (hit.kind === 'cell') {
      assert.equal(hit.rowIndex, 0);
      assert.equal(hit.dayIndex, 0);
    }
  });

  it('rejects double-counted scroll that would push day index forward', () => {
    // Visual day 3: x ≈ 3*DAY + 10. Adding scrollLeft=8*DAY (wrong) would look like day 11.
    const correct = hitTestCalendarCell({
      yInContent: ROW / 2,
      xInContent: DAY * 3 + 10,
      headerHeightPx: 0,
      itemHeightPx: ROW,
      dayColWidthPx: DAY,
      numDays: 14,
      numRows: 3,
    });
    assert.equal(correct.kind, 'cell');
    if (correct.kind === 'cell') {
      assert.equal(correct.dayIndex, 3);
    }

    const withDoubleScroll = hitTestCalendarCell({
      yInContent: ROW / 2,
      xInContent: DAY * 3 + 10 + DAY * 8,
      headerHeightPx: 0,
      itemHeightPx: ROW,
      dayColWidthPx: DAY,
      numDays: 14,
      numRows: 3,
    });
    assert.equal(withDoubleScroll.kind, 'cell');
    if (withDoubleScroll.kind === 'cell') {
      assert.equal(withDoubleScroll.dayIndex, 11);
    }
  });

  it('treats clicks in an in-content header zone as header', () => {
    const HEADER = 60;
    const hit = hitTestCalendarCell({
      yInContent: HEADER - 1,
      xInContent: DAY * 2,
      headerHeightPx: HEADER,
      itemHeightPx: ROW,
      dayColWidthPx: DAY,
      numDays: 14,
      numRows: 5,
    });
    assert.equal(hit.kind, 'header');
  });

  it('returns outOfBounds when dayColWidth is zero', () => {
    const hit = hitTestCalendarCell({
      yInContent: 10,
      xInContent: 50,
      headerHeightPx: 0,
      itemHeightPx: ROW,
      dayColWidthPx: 0,
      numDays: 14,
      numRows: 3,
    });
    assert.equal(hit.kind, 'outOfBounds');
  });
});
