'use client';

import type { RefObject } from 'react';
import { useEffect } from 'react';
import type { CalendarDateRange } from '../types';

export type UseCalendarTimelinePanOptions = {
  enabled: boolean;
  scrollRef: RefObject<HTMLElement | null>;
  dayColWidthPx: number;
  numDays: number;
  dateRange: CalendarDateRange;
  onDateRangeChange: (r: CalendarDateRange) => void;
};

/** Горизонтальное колесо / тачпад: двигаем timeline нативно, без смены диапазона дат. */
export function useCalendarTimelinePan({
  enabled,
  scrollRef,
}: UseCalendarTimelinePanOptions) {
  useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      const shiftVertical = e.shiftKey && Math.abs(e.deltaY) > 0;
      if (!horizontal && !shiftVertical) return;
      const delta = horizontal ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 0.25) return;
      e.preventDefault();
      el.scrollLeft += delta;
    };

    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, [enabled, scrollRef]);
}
