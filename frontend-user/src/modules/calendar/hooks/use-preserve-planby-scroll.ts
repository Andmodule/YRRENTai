'use client';

import type { RefObject } from 'react';
import { useLayoutEffect, useRef } from 'react';
import { format, startOfDay } from 'date-fns';
import type { CalendarDateRange } from '../types';

function dateRangeToken(dateRange: CalendarDateRange): string {
  return `${format(startOfDay(dateRange.start), 'yyyy-MM-dd')}|${format(startOfDay(dateRange.end), 'yyyy-MM-dd')}`;
}

/**
 * Keeps vertical scroll on the Planby container when the date window or EPG layout
 * remounts. Horizontal position is owned by timeline pan / edge shifting.
 */
export function usePreservePlanbyScroll(
  scrollRef: RefObject<HTMLElement | null>,
  dateRange: CalendarDateRange,
  layoutKey: string,
) {
  const scrollTopRef = useRef(0);
  const seenMountRef = useRef(false);
  const token = `${dateRangeToken(dateRange)}|${layoutKey}`;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      scrollTopRef.current = el.scrollTop;
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef, token]);

  useLayoutEffect(() => {
    if (!seenMountRef.current) {
      seenMountRef.current = true;
      return;
    }

    const top = scrollTopRef.current;

    const apply = () => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = top;
    };

    apply();
    const raf1 = requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });

    return () => cancelAnimationFrame(raf1);
  }, [scrollRef, token]);
}
