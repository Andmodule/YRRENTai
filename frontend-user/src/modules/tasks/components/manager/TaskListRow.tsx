'use client';

import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import { format, isToday, parseISO } from 'date-fns';
import { enUS, ru } from 'date-fns/locale';
import { Link2, ListTodo } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { useMatchMedia } from '@/hooks/use-match-media';
import type { Task, TaskStatus } from '../../types';
import { TaskListTypePill } from './TaskListTypePill';
import { TaskStatusBadge } from '../shared/TaskStatusBadge';
import { formatNameAndLastInitial } from '../../utils/staff-name-short';
import { TaskListRowMobile } from './TaskListRowMobile';

export const TaskListRow = memo(function TaskListRow({
  task,
  onOpen,
  onStatusChange,
  onSwipeDeleteTask,
  onSwipeMarkDone,
  swipeOpenRowId,
  onSwipeRowOpenChange,
}: {
  task: Task;
  onOpen: (t: Task) => void;
  onStatusChange: (uuid: string, status: TaskStatus) => void;
  /** TMA / mobile: deferred DELETE after swipe + undo toast */
  onSwipeDeleteTask?: (task: Task) => void;
  /** Mobile list: deferred “done” after confirm + undo toast (if omitted, swipe-done uses onStatusChange immediately) */
  onSwipeMarkDone?: (task: Task) => void;
  swipeOpenRowId: string | null;
  onSwipeRowOpenChange: (id: string | null) => void;
}) {
  const t = useTranslations('tasks');
  const tKanban = useTranslations('tasks.kanban');
  const tList = useTranslations('tasks.listByProperty');
  const tPill = useTranslations('tasks.listByProperty.typePill');
  const locale = useLocale();
  const dfLocale = locale === 'ru' ? ru : enUS;
  const isMdUp = useMatchMedia('(min-width: 768px)');

  /** Instant checkbox + strike before React Query paints the optimistic update */
  const [instantDone, setInstantDone] = useState(false);
  /** Десктоп: короткая анимация строки при «готово» с отложенным commit (как свайп на мобайл). */
  const [desktopMarkAnim, setDesktopMarkAnim] = useState(false);
  useEffect(() => {
    if (task.status === 'done') setInstantDone(false);
  }, [task.status]);

  const pillLabel =
    task.type === 'checkout_cleaning'
      ? tPill('checkout')
      : task.type === 'checkin_prep'
        ? tPill('checkin')
        : task.type === 'mid_stay_cleaning'
          ? tPill('midStay')
          : task.type === 'maintenance'
            ? tPill('maintenance')
            : tPill('other');

  const titleDisplay = task.title.trim() ? task.title.trim() : pillLabel;

  const norm = (s: string) =>
    s
      .replace(/[↑↓]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  /** Hide type pill when it repeats the title (same words, ignoring arrows). */
  const showTypePill =
    !task.title.trim() || norm(task.title) !== norm(pillLabel);

  const dueLabel = (() => {
    try {
      const d = parseISO(task.dueDate);
      if (isToday(d)) {
        if (task.dueTime?.trim()) {
          const parts = task.dueTime.trim().split(':');
          return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : task.dueTime;
        }
        return '—';
      }
      return format(d, 'd MMM', { locale: dfLocale });
    } catch {
      return task.dueTime ?? '—';
    }
  })();

  const onRowKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const target = e.target as HTMLElement;
        if (target.closest('button, [role="checkbox"], input, select, textarea, a')) return;
        e.preventDefault();
        onOpen(task);
      }
    },
    [onOpen, task],
  );

  const priorityDot = (() => {
    if (task.priority === 'critical') {
      return <span className="h-1 w-1 shrink-0 rounded-full bg-red-500" title={t('priority.critical')} />;
    }
    if (task.priority === 'urgent') {
      return (
        <span className="h-1 w-1 shrink-0 rounded-full bg-yellow-400 dark:bg-yellow-500" title={t('priority.urgent')} />
      );
    }
    return <span className="h-1 w-1 shrink-0 rounded-full bg-gray-400 dark:bg-gray-500" title={t('priority.normal')} />;
  })();

  const checklist = task.checklistSummary;
  const showChecklistPill =
    checklist && checklist.total > 0 ? (
      <span
        className="inline-flex shrink-0 items-center gap-0.5 tabular-nums text-[10px] text-muted-foreground"
        title={tList('checklistProgress', { checked: checklist.checked, total: checklist.total })}
      >
        <ListTodo className="h-2.5 w-2.5 shrink-0 opacity-70" aria-hidden />
        {checklist.checked}/{checklist.total}
      </span>
    ) : null;

  const checkedVisual = task.status === 'done' || instantDone;
  const doneVisual = task.status === 'done' || instantDone;

  const suppressRowClickRef = useRef(false);

  const canSwipeRightDone =
    !isMdUp && task.status !== 'issue' && task.status !== 'done' && !instantDone;
  const canSwipeLeftDelete =
    Boolean(onSwipeDeleteTask) && !isMdUp && task.status !== 'issue';

  const onSwipeRightDone = useCallback(() => {
    if (onSwipeMarkDone) {
      onSwipeMarkDone(task);
      return;
    }
    flushSync(() => setInstantDone(true));
    onStatusChange(task.uuid, 'done');
  }, [onStatusChange, onSwipeMarkDone, task]);

  const onSwipeDeleteAnimationEnd = useCallback(() => {
    onSwipeDeleteTask?.(task);
  }, [onSwipeDeleteTask, task]);

  const handleRowOpen = useCallback(() => {
    onOpen(task);
  }, [onOpen, task]);

  const rowClassName = cn(
    'flex w-full min-w-0 origin-top cursor-pointer flex-row items-start gap-2 border-b border-border/40 px-2 py-2 text-left md:px-3',
    'hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    'transition-colors',
    isMdUp && desktopMarkAnim && 'motion-safe:animate-task-row-complete',
  );

  const rowInner = (
    <>
      <div className="flex shrink-0 items-center gap-2 pt-0.5" onClick={(e) => e.stopPropagation()}>
        {priorityDot}
        {isMdUp ? (
          <Checkbox
            id={`task-done-${task.uuid}`}
            checked={checkedVisual}
            disabled={task.status === 'issue'}
            className={cn(
              'h-4 w-4 rounded border-slate-400 bg-white shadow-sm',
              'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
              'dark:border-input dark:bg-transparent dark:shadow-none',
            )}
            aria-label={tList('markDoneAria')}
            onCheckedChange={(checked) => {
              if (checked === true) {
                if (onSwipeMarkDone && task.status !== 'issue' && task.status !== 'done') {
                  setDesktopMarkAnim(true);
                  window.setTimeout(() => setDesktopMarkAnim(false), 450);
                  onSwipeMarkDone(task);
                  return;
                }
                flushSync(() => setInstantDone(true));
                onStatusChange(task.uuid, 'done');
              } else if (checked === false && (task.status === 'done' || instantDone)) {
                setInstantDone(false);
                onStatusChange(task.uuid, 'pending');
              }
            }}
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
        <span
          className={cn(
            'truncate text-sm font-normal leading-tight',
            doneVisual ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {titleDisplay}
        </span>
        {showTypePill || task.contextLabel || task.incidentId ? (
          <div
            className={cn(
              'flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5',
              doneVisual && 'opacity-70',
            )}
          >
            {showTypePill ? <TaskListTypePill type={task.type} /> : null}
            {task.incidentId ? (
              <span
                className="inline-flex max-w-[10rem] items-center gap-0.5 truncate rounded border border-border/60 bg-muted/35 px-1 py-px text-[9px] font-medium text-muted-foreground"
                title={tKanban('taskFromIncidentBadge')}
              >
                <Link2 className="h-2.5 w-2.5 shrink-0 opacity-80" aria-hidden />
                <span className="truncate">{tKanban('taskFromIncidentBadge')}</span>
              </span>
            ) : null}
            {task.status === 'issue' ? <TaskStatusBadge status="issue" size="sm" /> : null}
            {task.contextLabel ? (
              <span
                className={cn(
                  'min-w-0 truncate text-[9px] leading-tight text-muted-foreground/75',
                )}
              >
                {task.contextLabel}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        className={cn(
          'flex shrink-0 flex-col items-end gap-0.5 pt-0.5 text-[10px] tabular-nums text-muted-foreground',
          doneVisual && 'opacity-60',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1">
          {showChecklistPill}
          <span
            className="inline-flex max-w-[6rem] min-h-5 shrink-0 items-center justify-center truncate rounded-full bg-muted px-1.5 text-[9px] font-semibold leading-tight text-muted-foreground"
            title={task.assigneeName ?? t('unassigned')}
          >
            {task.assigneeName ? formatNameAndLastInitial(task.assigneeName) : '?'}
          </span>
        </div>
        <span className="whitespace-nowrap text-[9px] font-normal tabular-nums text-muted-foreground/70">
          {dueLabel}
        </span>
      </div>
    </>
  );

  if (!isMdUp && (canSwipeRightDone || canSwipeLeftDelete)) {
    return (
      <TaskListRowMobile
        rowId={task.uuid}
        swipeOpenRowId={swipeOpenRowId}
        onSwipeRowOpenChange={onSwipeRowOpenChange}
        rowClassName={rowClassName}
        canSwipeRightDone={canSwipeRightDone}
        canSwipeLeftDelete={canSwipeLeftDelete}
        onSwipeRightDone={onSwipeRightDone}
        onSwipeDeleteAnimationEnd={onSwipeDeleteAnimationEnd}
        doneRevealLabel={tList('swipeRevealLabel')}
        deleteRevealLabel={tList('swipeDeleteRevealLabel')}
        ariaRow={`${titleDisplay}. ${tList('swipeToCompleteAria')}${
          onSwipeDeleteTask ? ` ${tList('swipeToDeleteAria')}` : ''
        }`}
        suppressRowClickRef={suppressRowClickRef}
        onRowClick={handleRowOpen}
        onRowKeyDown={onRowKeyDown}
      >
        {rowInner}
      </TaskListRowMobile>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={rowClassName}
      onClick={() => onOpen(task)}
      onKeyDown={onRowKeyDown}
    >
      {rowInner}
    </div>
  );
});
