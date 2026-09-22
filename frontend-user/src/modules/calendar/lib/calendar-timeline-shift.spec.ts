import { describe, expect, it } from 'vitest';
import {
  getTimelineEdgeShift,
  scrollLeftAfterTimelineShift,
  shiftCalendarDateRange,
} from './calendar-timeline-shift';

const DAY = 96;
const range = {
  start: new Date('2026-03-01T12:00:00'),
  end: new Date('2026-03-14T12:00:00'),
};

describe('getTimelineEdgeShift', () => {
  it('detects past edge when scrolled near start', () => {
    expect(
      getTimelineEdgeShift({
        scrollLeft: 50,
        clientWidth: 800,
        scrollWidth: 14 * DAY,
        dayColWidthPx: DAY,
      }),
    ).toBe('past');
  });

  it('detects future edge when scrolled near end', () => {
    const scrollWidth = 14 * DAY;
    expect(
      getTimelineEdgeShift({
        scrollLeft: scrollWidth - 800 + 50,
        clientWidth: 800,
        scrollWidth,
        dayColWidthPx: DAY,
      }),
    ).toBe('future');
  });

  it('returns null in the middle of the range', () => {
    expect(
      getTimelineEdgeShift({
        scrollLeft: 7 * DAY,
        clientWidth: 800,
        scrollWidth: 14 * DAY,
        dayColWidthPx: DAY,
      }),
    ).toBeNull();
  });
});

describe('shiftCalendarDateRange', () => {
  it('shifts past by 7 days', () => {
    const next = shiftCalendarDateRange(range, 'past', 7);
    expect(next.start.toISOString().slice(0, 10)).toBe('2026-02-22');
    expect(next.end.toISOString().slice(0, 10)).toBe('2026-03-07');
  });
});

describe('scrollLeftAfterTimelineShift', () => {
  it('adds pixels when extending past', () => {
    expect(scrollLeftAfterTimelineShift(40, 'past', DAY, 7)).toBe(40 + 7 * DAY);
  });
});
