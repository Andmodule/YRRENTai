'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  rubberBandHorizontal,
  swipeActivationThresholdPx,
  swipeDeletePeekWidthPx,
} from '../../utils/swipe-physics';

const SWIPE_AXIS_LOCK_PX = 10;
const SWIPE_CLICK_SUPPRESS_PX = 14;
const SNAP_BACK_EASE = '[transition-timing-function:cubic-bezier(0.34,1.45,0.64,1)]';
const SLIDE_OFF_EASE = '[transition-timing-function:cubic-bezier(0.25,0.1,0.25,1)]';

type SwipeMode = 'idle' | 'scroll' | 'done' | 'delete';

export type TaskListRowDeleteExit = 'none' | 'sliding' | 'collapsing';

export function TaskListRowMobile({
  children,
  rowClassName,
  rowId,
  swipeOpenRowId,
  onSwipeRowOpenChange,
  canSwipeRightDone,
  canSwipeLeftDelete,
  onSwipeRightDone,
  onSwipeDeleteAnimationEnd,
  doneRevealLabel,
  deleteRevealLabel,
  ariaRow,
  suppressRowClickRef,
  onRowClick,
  onRowKeyDown,
}: {
  children: React.ReactNode;
  rowClassName: string;
  /** Row id for “only one delete strip open” coordination */
  rowId: string;
  swipeOpenRowId: string | null;
  onSwipeRowOpenChange: (id: string | null) => void;
  canSwipeRightDone: boolean;
  canSwipeLeftDelete: boolean;
  onSwipeRightDone: () => void;
  onSwipeDeleteAnimationEnd: () => void;
  doneRevealLabel: string;
  deleteRevealLabel: string;
  ariaRow: string;
  suppressRowClickRef: MutableRefObject<boolean>;
  onRowClick: () => void;
  onRowKeyDown: (e: KeyboardEvent) => void;
}) {
  const [dragX, setDragX] = useState(0);
  const dragXRef = useRef(0);
  const lastRawDxRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [deletePeekOpen, setDeletePeekOpen] = useState(false);
  const deletePeekOpenRef = useRef(false);
  useEffect(() => {
    deletePeekOpenRef.current = deletePeekOpen;
  }, [deletePeekOpen]);

  const swipeActiveRef = useRef(false);
  const swipeStartXRef = useRef(0);
  const swipeStartYRef = useRef(0);
  const dragStartOffsetRef = useRef(0);
  const adjustDeletePeekRef = useRef(false);
  const swipeAxisRef = useRef<'idle' | 'h' | 'v'>('idle');
  const modeRef = useRef<SwipeMode>('idle');
  const activationPxRef = useRef(100);
  const peekPxRef = useRef(96);
  const maxPullPxRef = useRef(140);
  const vibratedCrossRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<{ dx: number; dy: number } | null>(null);

  const [deleteExit, setDeleteExit] = useState<TaskListRowDeleteExit>('none');
  const [collapseMaxH, setCollapseMaxH] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  /** Another row opened delete peek — close this row’s delete peek */
  useEffect(() => {
    if (!deletePeekOpen) return;
    if (swipeOpenRowId !== rowId) {
      setDeletePeekOpen(false);
      dragXRef.current = 0;
      setDragX(0);
    }
  }, [swipeOpenRowId, rowId, deletePeekOpen]);

  const resetPointerState = useCallback(() => {
    swipeActiveRef.current = false;
    swipeAxisRef.current = 'idle';
    modeRef.current = 'idle';
    adjustDeletePeekRef.current = false;
    setIsDragging(false);
    if (deletePeekOpenRef.current) {
      const px = swipeDeletePeekWidthPx();
      dragXRef.current = -px;
      setDragX(-px);
    } else {
      dragXRef.current = 0;
      setDragX(0);
    }
    lastRawDxRef.current = 0;
    vibratedCrossRef.current = false;
    pendingMoveRef.current = null;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const applyMove = useCallback(
    (dx: number, dy: number) => {
      if (!swipeActiveRef.current) return;

      const peekPx = peekPxRef.current;

      if (adjustDeletePeekRef.current && canSwipeLeftDelete) {
        lastRawDxRef.current = dx;
        const next = dragStartOffsetRef.current + dx;
        const clamped = Math.max(-peekPx, Math.min(0, next));
        dragXRef.current = clamped;
        setDragX(clamped);
        return;
      }

      if (swipeAxisRef.current === 'idle') {
        if (Math.abs(dx) < SWIPE_AXIS_LOCK_PX && Math.abs(dy) < SWIPE_AXIS_LOCK_PX) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          swipeAxisRef.current = 'v';
          modeRef.current = 'scroll';
          resetPointerState();
          return;
        }
        swipeAxisRef.current = 'h';
        if (dx < 0) {
          modeRef.current = canSwipeLeftDelete ? 'delete' : 'idle';
        } else if (dx > 0) {
          modeRef.current = canSwipeRightDone ? 'done' : 'idle';
        } else {
          modeRef.current = 'idle';
        }
      }

      if (swipeAxisRef.current !== 'h') return;

      lastRawDxRef.current = dx;

      const mode = modeRef.current;
      const ap = activationPxRef.current;

      if (mode === 'idle' || mode === 'scroll') {
        const next = rubberBandHorizontal(dx, maxPullPxRef.current);
        dragXRef.current = next;
        setDragX(next);
        return;
      }

      if (mode === 'delete') {
        if (dx > SWIPE_CLICK_SUPPRESS_PX) {
          dragXRef.current = 0;
          setDragX(0);
          return;
        }
        const rb = rubberBandHorizontal(Math.min(dx, 0), maxPullPxRef.current);
        /** Do not pull past the red shelf width — avoids extra gap where the full-width green layer would show */
        const next = Math.max(-peekPx, rb);
        dragXRef.current = next;
        setDragX(next);
        if (dx <= -ap && !vibratedCrossRef.current) {
          vibratedCrossRef.current = true;
          try {
            navigator.vibrate(50);
          } catch {
            /* noop */
          }
        }
        if (Math.abs(dx) > SWIPE_CLICK_SUPPRESS_PX) suppressRowClickRef.current = true;
        return;
      }

      if (mode === 'done') {
        if (dx < -SWIPE_CLICK_SUPPRESS_PX) {
          dragXRef.current = 0;
          setDragX(0);
          return;
        }
        const next = rubberBandHorizontal(Math.max(dx, 0), maxPullPxRef.current);
        dragXRef.current = next;
        setDragX(next);
        if (dx >= ap && !vibratedCrossRef.current) {
          vibratedCrossRef.current = true;
          try {
            navigator.vibrate(50);
          } catch {
            /* noop */
          }
        }
        if (Math.abs(dx) > SWIPE_CLICK_SUPPRESS_PX) suppressRowClickRef.current = true;
      }
    },
    [canSwipeLeftDelete, canSwipeRightDone, resetPointerState, suppressRowClickRef],
  );

  const flushMove = useCallback(() => {
    rafRef.current = null;
    const p = pendingMoveRef.current;
    if (!p) return;
    applyMove(p.dx, p.dy);
  }, [applyMove]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (deleteExit !== 'none') return;
      if (e.button !== 0) return;
      suppressRowClickRef.current = false;
      swipeActiveRef.current = true;
      swipeAxisRef.current = 'idle';
      modeRef.current = 'idle';
      swipeStartXRef.current = e.clientX;
      swipeStartYRef.current = e.clientY;
      activationPxRef.current = swipeActivationThresholdPx();
      peekPxRef.current = swipeDeletePeekWidthPx();
      maxPullPxRef.current = 140;
      lastRawDxRef.current = 0;
      vibratedCrossRef.current = false;

      if (deletePeekOpenRef.current && canSwipeLeftDelete) {
        adjustDeletePeekRef.current = true;
        dragStartOffsetRef.current = dragXRef.current;
        swipeAxisRef.current = 'h';
        modeRef.current = 'delete';
      } else {
        adjustDeletePeekRef.current = false;
      }

      setIsDragging(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [deleteExit, canSwipeLeftDelete, suppressRowClickRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!swipeActiveRef.current || deleteExit !== 'none') return;
      const dx = e.clientX - swipeStartXRef.current;
      const dy = e.clientY - swipeStartYRef.current;
      pendingMoveRef.current = { dx, dy };
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flushMove);
      }
    },
    [deleteExit, flushMove],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      if (!swipeActiveRef.current) return;
      swipeActiveRef.current = false;
      const wasAdjustDeletePeek = adjustDeletePeekRef.current;
      adjustDeletePeekRef.current = false;
      swipeAxisRef.current = 'idle';
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      setIsDragging(false);
      const raw = lastRawDxRef.current;
      const mode = modeRef.current;
      const ap = activationPxRef.current;
      const peekPx = peekPxRef.current;

      if (wasAdjustDeletePeek && canSwipeLeftDelete && deletePeekOpenRef.current) {
        const x = dragXRef.current;
        const closeThreshold = -peekPx * 0.35;
        if (x >= closeThreshold) {
          setDeletePeekOpen(false);
          onSwipeRowOpenChange(null);
          dragXRef.current = 0;
          setDragX(0);
        } else {
          dragXRef.current = -peekPx;
          setDragX(-peekPx);
        }
        lastRawDxRef.current = 0;
        modeRef.current = 'idle';
        return;
      }

      if (mode === 'delete' && canSwipeLeftDelete && raw <= -ap && !deletePeekOpenRef.current) {
        try {
          navigator.vibrate(50);
        } catch {
          /* noop */
        }
        suppressRowClickRef.current = true;
        setDeletePeekOpen(true);
        onSwipeRowOpenChange(rowId);
        dragXRef.current = -peekPx;
        setDragX(-peekPx);
        lastRawDxRef.current = 0;
        modeRef.current = 'idle';
        return;
      }

      if (mode === 'done' && canSwipeRightDone && raw >= ap) {
        try {
          navigator.vibrate(50);
        } catch {
          /* noop */
        }
        onSwipeRightDone();
        suppressRowClickRef.current = true;
      }

      dragXRef.current = 0;
      setDragX(0);
      lastRawDxRef.current = 0;
      modeRef.current = 'idle';
    },
    [
      canSwipeLeftDelete,
      canSwipeRightDone,
      onSwipeRightDone,
      onSwipeRowOpenChange,
      rowId,
      suppressRowClickRef,
    ],
  );

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent) => {
      resetPointerState();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [resetPointerState],
  );

  const beginDeleteSlideOff = useCallback(() => {
    suppressRowClickRef.current = true;
    setDeletePeekOpen(false);
    onSwipeRowOpenChange(null);
    setDeleteExit('sliding');
    /** Commit delete / optimistic remove right away (not after slide+collapse) — avoids “hang”. */
    onSwipeDeleteAnimationEnd();
  }, [onSwipeDeleteAnimationEnd, onSwipeRowOpenChange, suppressRowClickRef]);

  const onRowTransformEnd = useCallback(
    (ev: React.TransitionEvent<HTMLDivElement>) => {
      if (deleteExit !== 'sliding' || ev.propertyName !== 'transform') return;
      const el = rootRef.current;
      const h = el?.offsetHeight ?? 0;
      setCollapseMaxH(h);
      setDeleteExit('collapsing');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setCollapseMaxH(0));
      });
    },
    [deleteExit],
  );

  const onCollapseEnd = useCallback(
    (ev: React.TransitionEvent<HTMLDivElement>) => {
      if (deleteExit !== 'collapsing' || ev.propertyName !== 'max-height') return;
      setDeleteExit('none');
      setCollapseMaxH(null);
    },
    [deleteExit],
  );

  const apDisplay = swipeActivationThresholdPx();
  const peekPxDisplay = swipeDeletePeekWidthPx();
  const raw = lastRawDxRef.current;
  const doneProgress = Math.min(1, Math.max(0, raw) / Math.max(apDisplay, 1));
  /** Only left drag reveals delete — never use |dragX| or right-swipe would show trash/red */
  const deletePeekProgress =
    deletePeekOpen
      ? 1
      : dragX < 0
        ? Math.min(1, Math.max(0, -dragX) / Math.max(peekPxDisplay, 1))
        : 0;

  const transformStyle =
    deleteExit === 'sliding' || deleteExit === 'collapsing'
      ? 'translate3d(-100%,0,0)'
      : `translate3d(${dragX}px,0,0)`;

  const rowTransition = (() => {
    if (deleteExit === 'sliding') return cn('transition-transform duration-150', SLIDE_OFF_EASE);
    if (deleteExit === 'collapsing') return undefined;
    if (!isDragging) return cn('transition-transform duration-300', SNAP_BACK_EASE);
    return undefined;
  })();

  const handleRowClick = useCallback(() => {
    if (deleteExit !== 'none') return;
    if (suppressRowClickRef.current) {
      suppressRowClickRef.current = false;
      return;
    }
    onRowClick();
  }, [deleteExit, onRowClick, suppressRowClickRef]);

  const collapsing = deleteExit === 'collapsing';

  const revealDelete = canSwipeLeftDelete && (deletePeekOpen || dragX < 0);
  const showDeleteAbove = revealDelete && (!canSwipeRightDone || dragX <= 0);
  const revealDone = canSwipeRightDone && !deletePeekOpen && dragX > 0;
  const showDoneAbove = revealDone;

  const trashVisible =
    deleteExit === 'none' &&
    canSwipeLeftDelete &&
    (deletePeekOpen || (dragX < 0 && deletePeekProgress > 0.15));

  return (
    <div
      ref={rootRef}
      className="relative w-full min-w-0 overflow-hidden touch-pan-y"
      style={{
        maxHeight: collapseMaxH === null ? undefined : collapseMaxH,
        marginTop: collapsing ? 0 : undefined,
        marginBottom: collapsing ? 0 : undefined,
        overflow: collapseMaxH === null ? undefined : 'hidden',
        transition: collapsing ? 'max-height 0.32s ease, margin 0.32s ease' : undefined,
      }}
      onTransitionEnd={onCollapseEnd}
    >
      {(canSwipeLeftDelete || canSwipeRightDone) && (
        <div className="pointer-events-none absolute inset-0 z-0">
          {revealDelete ? (
            <div
              className={cn(
                'absolute right-0 top-0 h-full bg-red-500 shadow-sm ring-1 ring-black/10 dark:ring-white/10',
                'rounded-l-md',
                showDeleteAbove ? 'z-[1]' : 'z-0',
              )}
              style={{ width: peekPxDisplay }}
            >
              <span className="sr-only">{deleteRevealLabel}</span>
            </div>
          ) : null}
          {revealDone ? (
            <div
              className={cn(
                'absolute left-0 top-0 flex h-full items-center justify-center bg-emerald-500 dark:bg-emerald-600',
                'rounded-r-md shadow-sm ring-1 ring-black/10 dark:ring-white/10',
                showDoneAbove ? 'z-[1]' : 'z-0',
              )}
              style={{ width: peekPxDisplay }}
            >
              <span
                className="select-none px-1 text-center text-[10px] font-bold uppercase leading-tight tracking-wide text-white"
                style={{ opacity: 0.2 + 0.8 * doneProgress }}
              >
                {doneRevealLabel}
              </span>
            </div>
          ) : null}
        </div>
      )}

      {trashVisible ? (
        <button
          type="button"
          tabIndex={-1}
          className={cn(
            'absolute right-0 top-0 z-[1] flex items-center justify-center rounded-l-md text-white/95 outline-none',
            'pointer-events-auto touch-manipulation active:opacity-90',
          )}
          style={{
            width: peekPxDisplay,
            height: '100%',
            opacity: 0.35 + 0.65 * deletePeekProgress,
            transform: `scale(${0.88 + 0.12 * deletePeekProgress})`,
          }}
          aria-label={deleteRevealLabel}
          onPointerDown={(ev) => {
            ev.stopPropagation();
          }}
          onClick={(ev) => {
            ev.stopPropagation();
            beginDeleteSlideOff();
          }}
        >
          <Trash2 className="h-6 w-6 shrink-0 drop-shadow-sm" strokeWidth={2.25} aria-hidden />
        </button>
      ) : null}

      <div
        role="button"
        tabIndex={deleteExit === 'none' ? 0 : -1}
        className={cn(
          rowClassName,
          'relative z-[2] bg-background',
          rowTransition,
          isDragging && 'select-none',
          deleteExit !== 'none' && 'pointer-events-none',
        )}
        style={{
          transform: transformStyle,
          willChange: deleteExit === 'none' && isDragging ? 'transform' : undefined,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onTransitionEnd={onRowTransformEnd}
        onClick={handleRowClick}
        onKeyDown={onRowKeyDown}
        aria-label={ariaRow}
      >
        {children}
      </div>
    </div>
  );
}
