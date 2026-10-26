'use client';

import { useEffect, useRef } from 'react';
import { orderedRange } from '../lib/property-month';

/** A finger has to rest this long on a date before a drag starts — a quick swipe still scrolls the page. */
const LONG_PRESS_MS = 350;
/** A finger that moves farther than this before the long press is scrolling, not picking. */
const MOVE_TOLERANCE_PX = 10;
/** A mouse has to move this far before a press becomes a drag — a shaky click stays a click. */
const MOUSE_DRAG_PX = 5;
/** The click that ends a drag comes right after the release; later clicks (keyboard too) are left alone. */
const SWALLOW_CLICK_MS = 400;

type DragState = {
  start: string;
  last: string;
  pointerId: number;
  touch: boolean;
  x: number;
  y: number;
  dragging: boolean;
  timer: number | null;
};

function ymdAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  return el?.closest<HTMLElement>('[data-ymd]')?.dataset.ymd ?? null;
}

/**
 * Picking a range by dragging over the month, as in Booking and Airbnb: the mouse (and a pen) drags at once;
 * a finger rests on the first date (long press), then slides. A plain click / tap is left to the cells (first date,
 * second date). Cells carry `data-ymd`; the click that ends a drag is swallowed so it does not re-pick.
 */
export function useRangeDrag<T extends HTMLElement>(onRange: (from: string, to: string) => void) {
  const ref = useRef<T>(null);
  const onRangeRef = useRef(onRange);
  onRangeRef.current = onRange;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let state: DragState | null = null;
    let swallowClick = false;
    let swallowTimer: number | null = null;

    const emit = (end: string) => {
      if (!state || end === state.last) return;
      state.last = end;
      const [a, b] = orderedRange(state.start, end);
      onRangeRef.current(a, b);
    };
    const begin = () => {
      if (!state || state.dragging) return;
      state.dragging = true;
      emit(state.start);
      if (state.touch) navigator.vibrate?.(10);
    };
    const clear = () => {
      if (state?.timer != null) window.clearTimeout(state.timer);
      state = null;
    };
    const finish = () => {
      if (state?.dragging) {
        swallowClick = true;
        if (swallowTimer != null) window.clearTimeout(swallowTimer);
        swallowTimer = window.setTimeout(() => {
          swallowClick = false;
          swallowTimer = null;
        }, SWALLOW_CLICK_MS);
      }
      clear();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const ymd = (e.target as HTMLElement).closest<HTMLElement>('[data-ymd]')?.dataset.ymd;
      if (!ymd) return;
      clear();
      swallowClick = false;
      const touch = e.pointerType === 'touch';
      state = { start: ymd, last: '', pointerId: e.pointerId, touch, x: e.clientX, y: e.clientY, dragging: false, timer: null };
      if (touch) state.timer = window.setTimeout(begin, LONG_PRESS_MS);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!state || e.pointerId !== state.pointerId) return;
      if (!state.dragging) {
        if (state.touch) {
          if (Math.hypot(e.clientX - state.x, e.clientY - state.y) > MOVE_TOLERANCE_PX) clear();
          return;
        }
        if (e.buttons === 0) {
          // The release was lost (let go outside the window): hovering must not start a drag.
          clear();
          return;
        }
        if (Math.hypot(e.clientX - state.x, e.clientY - state.y) < MOUSE_DRAG_PX) return;
        const here = ymdAt(e.clientX, e.clientY);
        if (!here || here === state.start) return;
        begin();
      } else if (!state.touch && e.buttons === 0) {
        finish();
        return;
      }
      if (state.touch) return; // a finger is followed by touchmove (pointer events may stop once the page would scroll)
      const here = ymdAt(e.clientX, e.clientY);
      if (here) emit(here);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!state || e.pointerId !== state.pointerId) return;
      // A finger that is dragging ends on touchend; a tap (no drag yet) is let go here.
      if (!state.touch || !state.dragging) finish();
    };
    const onPointerCancel = (e: PointerEvent) => {
      // A finger that is dragging keeps going on touch events; one that was about to scroll is let go.
      if (state && e.pointerId === state.pointerId && !state.dragging) clear();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!state?.dragging) return;
      e.preventDefault(); // the page does not scroll while a range is drawn
      const t = e.touches[0];
      const here = t ? ymdAt(t.clientX, t.clientY) : null;
      if (here) emit(here);
    };
    const onTouchEnd = () => {
      if (state?.touch) finish();
    };
    const onClickCapture = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    };
    const onContextMenu = (e: Event) => {
      if (state) e.preventDefault(); // a long press must not open the phone's menu
    };

    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    el.addEventListener('click', onClickCapture, true);
    el.addEventListener('contextmenu', onContextMenu);
    return () => {
      clear();
      if (swallowTimer != null) window.clearTimeout(swallowTimer);
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('click', onClickCapture, true);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  return ref;
}
