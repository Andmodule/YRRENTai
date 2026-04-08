'use client';

import { memo, useRef, useState, useCallback, useEffect } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  KeyRound,
  Brush,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import type { Task } from '@/hooks/use-tasks';
import type { DeadlineUrgency } from '@/lib/shift-utils';
import { formatElapsedMs } from '@/lib/shift-utils';

const SWIPE_THRESHOLD = 60;

interface ChecklistItemProps {
  task: Task;
  /** Показать дату, если задача не на «сегодня» (как в списке после широкого запроса задач). */
  dueDayHint?: string;
  deadlineUrgency: DeadlineUrgency;
  onMarkDone: (uuid: string) => void;
  onMarkIssue: (uuid: string) => void;
  /** Row tap (not checkbox): quick actions drawer */
  onQuickOpen: (task: Task) => void;
}

const typeLabels: Record<string, string> = {
  checkout_cleaning: 'Уборка (выезд)',
  checkin_prep: 'Подготовка к заезду',
  mid_stay_cleaning: 'Плановая уборка',
  manual: 'Задача',
};

function TypeIcon({ type }: { type: string }) {
  if (type === 'checkout_cleaning') return <Brush className="h-4 w-4 shrink-0 text-teal-600" aria-hidden />;
  if (type === 'checkin_prep') return <KeyRound className="h-4 w-4 shrink-0 text-teal-600" aria-hidden />;
  if (type === 'mid_stay_cleaning') return <Sparkles className="h-4 w-4 shrink-0 text-teal-600" aria-hidden />;
  return <ClipboardIcon />;
}

function ClipboardIcon() {
  return <Sparkles className="h-4 w-4 shrink-0 text-teal-600" aria-hidden />;
}

const urgencyRing: Record<DeadlineUrgency, string> = {
  teal: 'ring-1 ring-teal-200/50',
  amber: 'ring-1 ring-amber-300/70',
  amber_pulse: 'ring-2 ring-amber-400 animate-pulse',
  red: 'ring-2 ring-rose-500',
};

export const ChecklistItem = memo(function ChecklistItem({
  task,
  dueDayHint,
  deadlineUrgency,
  onMarkDone,
  onMarkIssue,
  onQuickOpen,
}: ChecklistItemProps) {
  const isDone = task.status === 'done';
  const isIssue = task.status === 'issue';
  const inProgress = task.status === 'in_progress';
  const touchStartX = useRef<number | null>(null);
  const [swipeDelta, setSwipeDelta] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!inProgress || !task.inProgressStartedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [inProgress, task.inProgressStartedAt]);

  const triggerAction = useCallback(
    (direction: 'done' | 'issue') => {
      if (leaving) return;
      setLeaving(true);
      setTimeout(() => {
        if (direction === 'done') onMarkDone(task.uuid);
        else onMarkIssue(task.uuid);
      }, 220);
    },
    [leaving, task.uuid, onMarkDone, onMarkIssue],
  );

  const handleTouchStart = (e: React.TouchEvent) => {
    const x = e.touches[0]?.clientX;
    if (x === undefined) return;
    touchStartX.current = x;
    setSwipeDelta(0);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const x = e.touches[0]?.clientX;
    if (x === undefined) return;
    const delta = x - touchStartX.current;
    setSwipeDelta(delta);
  };

  const handleTouchEnd = () => {
    if (swipeDelta > SWIPE_THRESHOLD && !isDone) {
      triggerAction('done');
    } else if (swipeDelta < -SWIPE_THRESHOLD && !isDone && !isIssue) {
      triggerAction('issue');
    }
    touchStartX.current = null;
    setSwipeDelta(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ' && !e.shiftKey && !isDone) {
      e.preventDefault();
      triggerAction('done');
    } else if (e.key === ' ' && e.shiftKey && !isDone && !isIssue) {
      e.preventDefault();
      triggerAction('issue');
    } else if (e.key === 'Enter') {
      onQuickOpen(task);
    }
  };

  const revealRight = swipeDelta > 20;
  const revealLeft = swipeDelta < -20;
  const street = task.streetAddress || task.propertyAddress;

  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div className="absolute inset-0 flex rounded-2xl" aria-hidden>
        <div className="flex flex-1 items-center bg-gradient-to-br from-teal-500 to-emerald-600 pl-4">
          <CheckCircle2 className="h-6 w-6 text-white/95 drop-shadow-sm" />
        </div>
        <div className="flex flex-1 items-center justify-end bg-gradient-to-bl from-amber-400 to-amber-500 pr-4">
          <AlertCircle className="h-6 w-6 text-white drop-shadow-sm" />
        </div>
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label={`Задача: ${task.propertyTitle}`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onKeyDown={handleKeyDown}
        onClick={() => onQuickOpen(task)}
        className={`relative z-10 flex min-h-14 cursor-pointer select-none items-center gap-3 rounded-2xl border px-4 py-3 shadow-md shadow-slate-900/5 transition-all duration-200 hover:shadow-lg active:scale-[0.99] ${urgencyRing[deadlineUrgency]} ${
          isIssue
            ? 'border-amber-200/90 bg-amber-50/90 hover:border-amber-300/80'
            : 'border-slate-200/90 bg-white hover:border-teal-200/80'
        }`}
        style={{
          transform: `translateX(${swipeDelta}px)`,
          transition: swipeDelta !== 0 ? 'none' : 'transform 0.2s ease-out',
          opacity: leaving ? 0 : 1,
          backgroundColor: revealRight
            ? 'rgba(236, 253, 245, 0.96)'
            : revealLeft
              ? 'rgba(255, 251, 235, 0.96)'
              : undefined,
        }}
      >
        <span onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isDone}
            aria-label={`Отметить выполненной: ${task.propertyTitle}`}
            onCheckedChange={(checked) => {
              if (checked && !isDone) triggerAction('done');
            }}
          />
        </span>

        <TypeIcon type={task.type} />

        <div className="min-w-0 flex-1">
          <p
            className={`truncate text-sm font-semibold ${isDone ? 'text-slate-400 line-through' : 'text-slate-900'}`}
          >
            {task.propertyTitle}
          </p>
          <p className="truncate text-xs text-slate-500" title={street}>
            {street}
          </p>
          <p className="truncate text-xs text-slate-600">
            {typeLabels[task.type] ?? task.type}
            {task.contextLabel ? ` · ${task.contextLabel}` : ''}
          </p>
          {dueDayHint ? (
            <p className="mt-0.5 text-xs font-medium capitalize text-teal-700">{dueDayHint}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {inProgress && task.inProgressStartedAt && (
            <span className="rounded-lg bg-teal-50 px-2 py-0.5 font-mono text-xs text-teal-800">
              {formatElapsedMs(task.inProgressStartedAt)}
            </span>
          )}
          {task.dueTime && (
            <span className="flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              <Clock className="h-3 w-3" />
              {task.dueTime}
            </span>
          )}
          {task.priority === 'urgent' && (
            <span className="h-2 w-2 rounded-full bg-amber-500 ring-2 ring-amber-200/80" title="Срочно" />
          )}
          {isIssue && (
            <AlertCircle className="h-4 w-4 text-amber-600" aria-label="Нужно внимание менеджера" />
          )}
        </div>
      </div>
    </div>
  );
});
