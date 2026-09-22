'use client';

import type { RefObject } from 'react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { format, startOfDay } from 'date-fns';
import type { CalendarDateRange } from '../types';
import { CALENDAR_TIMELINE_SHIFT_DAYS } from '../constants/calendar-timeline.constants';
import {
  getTimelineEdgeShift,
  scrollLeftAfterTimelineShift,
  shiftCalendarDateRange,
  type TimelineEdgeShift,
} from '../lib/calendar-timeline-shift';

export type UseCalendarTimelinePanOptions = {
  enabled: boolean;
  scrollRef: RefObject<HTMLElement | null>;
  dayColWidthPx: number;
  dateRange: CalendarDateRange;
  onDateRangeChange: (r: CalendarDateRange) => void;
};

const DRAG_START_THRESHOLD_PX = 5;

function isPanExcludedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (target.closest('[data-testid="program-item"]')) return true;
  if (target.closest('button, a, input, select, textarea, [role="button"]')) return true;
  return false;
}

/** Horizontal wheel / drag pan; shifts date window at edges so the timeline feels continuous. */
export function useCalendarTimelinePan({
  enabled,
  scrollRef,
  dayColWidthPx,
  dateRange,
  onDateRangeChange,
}: UseCalendarTimelinePanOptions) {
  const dateRangeRef = useRef(dateRange);
  dateRangeRef.current = dateRange;

  const onDateRangeChangeRef = useRef(onDateRangeChange);
  onDateRangeChangeRef.current = onDateRangeChange;

  const dayColWidthRef = useRef(dayColWidthPx);
  dayColWidthRef.current = dayColWidthPx;

  const shiftingRef = useRef(false);
  const pendingScrollLeftRef = useRef<number | null>(null);
  const edgeRafRef = useRef<number | null>(null);

  const dateRangeToken = `${format(startOfDay(dateRange.start), 'yyyy-MM-dd')}|${format(startOfDay(dateRange.end), 'yyyy-MM-dd')}`;

  useLayoutEffect(() => {
    if (pendingScrollLeftRef.current == null) return;
    const left = pendingScrollLeftRef.current;
    pendingScrollLeftRef.current = null;

    const apply = () => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollLeft = left;
    };

    apply();
    const raf = requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollRef, dateRangeToken]);

  useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;

    const runEdgeShift = () => {
      if (shiftingRef.current) return;
      const colW = dayColWidthRef.current;
      if (colW <= 0) return;

      const edge = getTimelineEdgeShift({
        scrollLeft: el.scrollLeft,
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        dayColWidthPx: colW,
      });
      if (!edge) return;

      shiftingRef.current = true;
      const nextLeft = scrollLeftAfterTimelineShift(el.scrollLeft, edge, colW);
      pendingScrollLeftRef.current = nextLeft;
      onDateRangeChangeRef.current(shiftCalendarDateRange(dateRangeRef.current, edge));

      requestAnimationFrame(() => {
        shiftingRef.current = false;
      });
    };

    const scheduleEdgeShift = () => {
      if (edgeRafRef.current != null) return;
      edgeRafRef.current = requestAnimationFrame(() => {
        edgeRafRef.current = null;
        runEdgeShift();
      });
    };

    const onWheel = (e: WheelEvent) => {
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      const shiftVertical = e.shiftKey && Math.abs(e.deltaY) > 0;
      if (!horizontal && !shiftVertical) return;
      const delta = horizontal ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 0.25) return;
      e.preventDefault();
      el.scrollLeft += delta;
      scheduleEdgeShift();
    };

    let pointerId: number | null = null;
    let dragStartX = 0;
    let dragStartScrollLeft = 0;
    let lastMoveX = 0;
    let dragCarryPx = 0;
    let dragging = false;
    let blockNextClick = false;

    const shiftByGesture = (direction: TimelineEdgeShift) => {
      if (shiftingRef.current) return;
      shiftingRef.current = true;
      onDateRangeChangeRef.current(shiftCalendarDateRange(dateRangeRef.current, direction));
      requestAnimationFrame(() => {
        shiftingRef.current = false;
      });
    };

    const applyDragCarry = (deltaPx: number) => {
      const colW = dayColWidthRef.current;
      if (colW <= 0) return;
      dragCarryPx += deltaPx;
      const stepPx = CALENDAR_TIMELINE_SHIFT_DAYS * colW;
      if (Math.abs(dragCarryPx) < stepPx) return;
      const direction: TimelineEdgeShift = dragCarryPx > 0 ? 'past' : 'future';
      dragCarryPx = 0;
      shiftByGesture(direction);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || isPanExcludedTarget(e.target)) return;
      pointerId = e.pointerId;
      dragStartX = e.clientX;
      lastMoveX = e.clientX;
      dragStartScrollLeft = el.scrollLeft;
      dragCarryPx = 0;
      dragging = false;
      el.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - dragStartX;
      if (!dragging && Math.abs(dx) < DRAG_START_THRESHOLD_PX) return;

      if (!dragging) {
        dragging = true;
        el.style.cursor = 'grabbing';
        el.style.userSelect = 'none';
      }

      e.preventDefault();
      const canScrollX = el.scrollWidth > el.clientWidth + 1;
      if (canScrollX) {
        el.scrollLeft = dragStartScrollLeft - dx;
        scheduleEdgeShift();
      } else {
        applyDragCarry(e.clientX - lastMoveX);
      }
      lastMoveX = e.clientX;
    };

    const endPointer = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
      pointerId = null;
      if (dragging) {
        blockNextClick = true;
        el.style.cursor = '';
        el.style.userSelect = '';
        scheduleEdgeShift();
      }
      dragging = false;
      dragCarryPx = 0;
    };

    const onClickCapture = (e: MouseEvent) => {
      if (!blockNextClick) return;
      e.preventDefault();
      e.stopPropagation();
      blockNextClick = false;
    };

    const onScroll = () => {
      scheduleEdgeShift();
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endPointer);
    el.addEventListener('pointercancel', endPointer);
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('click', onClickCapture, true);

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endPointer);
      el.removeEventListener('pointercancel', endPointer);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('click', onClickCapture, true);
      if (edgeRafRef.current != null) {
        cancelAnimationFrame(edgeRafRef.current);
        edgeRafRef.current = null;
      }
    };
  }, [enabled, scrollRef, dayColWidthPx]);

}
