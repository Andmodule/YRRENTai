import { addDays, subDays } from 'date-fns';
import { CALENDAR_TIMELINE_SHIFT_DAYS } from '../constants/calendar-timeline.constants';
import type { CalendarDateRange } from '../types';

export type TimelineEdgeShift = 'past' | 'future';

const DEFAULT_EDGE_DAYS = 2;

export function getTimelineEdgeShift(args: {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
  dayColWidthPx: number;
  edgeDays?: number;
}): TimelineEdgeShift | null {
  const { scrollLeft, clientWidth, scrollWidth, dayColWidthPx } = args;
  if (dayColWidthPx <= 0 || scrollWidth <= clientWidth) return null;

  const edgeDays = args.edgeDays ?? DEFAULT_EDGE_DAYS;
  const edgePx = edgeDays * dayColWidthPx;

  if (scrollLeft <= edgePx) return 'past';
  if (scrollLeft + clientWidth >= scrollWidth - edgePx) return 'future';
  return null;
}

export function shiftCalendarDateRange(
  range: CalendarDateRange,
  direction: TimelineEdgeShift,
  days: number = CALENDAR_TIMELINE_SHIFT_DAYS,
): CalendarDateRange {
  if (direction === 'past') {
    return {
      start: subDays(range.start, days),
      end: subDays(range.end, days),
    };
  }
  return {
    start: addDays(range.start, days),
    end: addDays(range.end, days),
  };
}

export function scrollLeftAfterTimelineShift(
  currentScrollLeft: number,
  direction: TimelineEdgeShift,
  dayColWidthPx: number,
  days: number = CALENDAR_TIMELINE_SHIFT_DAYS,
): number {
  const stepPx = days * dayColWidthPx;
  const next = direction === 'past' ? currentScrollLeft + stepPx : currentScrollLeft - stepPx;
  return Math.max(0, next);
}
