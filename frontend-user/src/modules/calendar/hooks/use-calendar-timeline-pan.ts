'use client';

import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';
import { addDays, startOfDay } from 'date-fns';
import type { CalendarDateRange } from '../types';

/** После последнего тика колеса ждём паузу — затем сдвигаем окно дат и обновляем шапку / данные. */
const PAN_IDLE_MS = 320;

export type UseCalendarTimelinePanOptions = {
  enabled: boolean;
  scrollRef: RefObject<HTMLElement | null>;
  dayColWidthPx: number;
  numDays: number;
  dateRange: CalendarDateRange;
  onDateRangeChange: (r: CalendarDateRange) => void;
};

/**
 * Горизонтальное колесо / тачпад (deltaX или Shift+колесо) и горизонтальный свайп на тач:
 * накапливаем смещение в пикселях, после паузы переводим в целые дни (ширина колонки = 1 сутки).
 */
export function useCalendarTimelinePan({
  enabled,
  scrollRef,
  dayColWidthPx,
  numDays,
  dateRange,
  onDateRangeChange,
}: UseCalendarTimelinePanOptions) {
  const drRef = useRef(dateRange);
  drRef.current = dateRange;
  const onChangeRef = useRef(onDateRangeChange);
  onChangeRef.current = onDateRangeChange;
  const dayWRef = useRef(dayColWidthPx);
  dayWRef.current = dayColWidthPx;
  const numDaysRef = useRef(numDays);
  numDaysRef.current = numDays;

  const panAccumRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    panAccumRef.current = 0;
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, [dateRange.start.getTime(), dateRange.end.getTime()]);

  useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;

    let cancelled = false;
    const maxDays = Math.min(45, Math.max(14, numDaysRef.current));

    const applyShiftDays = (days: number) => {
      if (days === 0) return;
      const dr = drRef.current;
      onChangeRef.current({
        start: addDays(startOfDay(dr.start), days),
        end: addDays(startOfDay(dr.end), days),
      });
    };

    const flushWheelAccum = () => {
      idleTimerRef.current = null;
      if (cancelled) return;
      const w = dayWRef.current;
      if (w <= 0.5) {
        panAccumRef.current = 0;
        return;
      }
      const raw = Math.round(panAccumRef.current / w);
      panAccumRef.current = 0;
      if (raw === 0) return;
      const days = Math.max(-maxDays, Math.min(maxDays, raw));
      applyShiftDays(days);
    };

    const scheduleFlush = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(flushWheelAccum, PAN_IDLE_MS);
    };

    const onWheel = (e: WheelEvent) => {
      const w = dayWRef.current;
      if (w <= 0.5) return;
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      const shiftVertical = e.shiftKey && Math.abs(e.deltaY) > 0;
      if (!horizontal && !shiftVertical) return;
      const delta = horizontal ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 0.25) return;
      e.preventDefault();
      panAccumRef.current += delta;
      scheduleFlush();
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        touchStartRef.current = null;
        return;
      }
      const p = e.touches.item(0);
      if (!p) {
        touchStartRef.current = null;
        return;
      }
      touchStartRef.current = { x: p.clientX, y: p.clientY };
    };

    const onTouchEnd = (e: TouchEvent) => {
      const start = touchStartRef.current;
      touchStartRef.current = null;
      if (!start || e.changedTouches.length !== 1) return;
      const w = dayWRef.current;
      if (w <= 0.5) return;
      const endP = e.changedTouches.item(0);
      if (!endP) return;
      const x = endP.clientX;
      const y = endP.clientY;
      const dx = start.x - x;
      const dy = start.y - y;
      const minMove = 28;
      if (Math.abs(dx) < minMove || Math.abs(dx) < Math.abs(dy)) return;
      const raw = Math.round(dx / w);
      if (raw === 0) return;
      const days = Math.max(-maxDays, Math.min(maxDays, raw));
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      panAccumRef.current = 0;
      applyShiftDays(days);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      cancelled = true;
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [enabled, scrollRef, dayColWidthPx, numDays]);
}
