'use client';

import { memo, useState, useEffect } from 'react';
import { Clock, Mic, Pencil, Wrench, AlertTriangle, ClipboardList } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import type { Task } from '@/hooks/use-tasks';
import type { DeadlineUrgency } from '@/lib/shift-utils';
import { formatElapsedMs } from '@/lib/shift-utils';
import { useStaffStrings } from '@/locales/staff-strings';

interface ChecklistItemProps {
  task: Task;
  /** Карточка в светлой нижней шторке: без «тёмной» заливки при тёмной теме ОС. */
  sheetSurface?: boolean;
  /** Показать дату, если задача не на «сегодня» (как в списке после широкого запроса задач). */
  dueDayHint?: string;
  deadlineUrgency: DeadlineUrgency;
  onMarkDone: (uuid: string) => void;
  /** Row tap (not checkbox): quick actions drawer */
  onQuickOpen: (task: Task) => void;
  /** Голосовой отчёт с привязкой к этой задаче (кнопка на карточке). */
  onVoiceForTask?: (task: Task) => void;
  /** Текстовое дополнение к задаче — тот же interpret-text, что в «Истории». */
  onTextForTask?: (task: Task) => void;
}

const typeLabels: Record<string, string> = {
  checkout_cleaning: 'Уборка (выезд)',
  checkin_prep: 'Подготовка к заезду',
  mid_stay_cleaning: 'Плановая уборка',
  manual: 'Задача',
  other: 'Прочее',
  incident: 'Инцидент',
  maintenance: 'Обслуживание',
  lost_item: 'Забытая вещь',
  damage: 'Повреждение',
};

const urgencyRing: Record<DeadlineUrgency, string> = {
  teal: 'ring-1 ring-teal-200/50 dark:ring-teal-900/40',
  amber: 'ring-1 ring-amber-300/70 dark:ring-amber-700/50',
  amber_pulse: 'ring-2 ring-amber-400 animate-pulse dark:ring-amber-500',
  red: 'ring-2 ring-rose-500 dark:ring-rose-500',
};

const cardActionBtnClass =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-amber-200/90 bg-gradient-to-b from-amber-50 to-teal-50/80 text-teal-700 shadow-sm ring-1 ring-amber-100/80 transition-colors hover:border-amber-300 hover:bg-amber-50 active:scale-95 dark:border-amber-600/50 dark:from-teal-950/60 dark:to-amber-950/40 dark:text-teal-200 dark:ring-amber-900/40';

export const ChecklistItem = memo(function ChecklistItem({
  task,
  sheetSurface = false,
  dueDayHint,
  deadlineUrgency,
  onMarkDone,
  onQuickOpen,
  onVoiceForTask,
  onTextForTask,
}: ChecklistItemProps) {
  const str = useStaffStrings();
  const isDone = task.status === 'done';
  const isIssue = task.status === 'issue';
  const inProgress = task.status === 'in_progress';
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!inProgress || !task.inProgressStartedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [inProgress, task.inProgressStartedAt]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onQuickOpen(task);
    }
  };

  const street = task.streetAddress || task.propertyAddress;
  const isGeneral = task.isGeneralTask === true;
  const isIncidentType = task.type === 'incident' || task.type === 'damage' || task.type === 'lost_item';
  const isMaintenance = task.type === 'maintenance';
  const placeLabel = isGeneral ? str.tasks.checklist.generalTaskLabel : task.propertyTitle;
  const secondaryLine = isGeneral ? (task.title?.trim() || '') : street;
  const showReportActions = !isDone && (onVoiceForTask || onTextForTask);

  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div
        role="button"
        tabIndex={0}
        aria-label={`Задача: ${placeLabel}`}
        onKeyDown={handleKeyDown}
        onClick={() => onQuickOpen(task)}
        className={`relative z-10 flex min-h-14 cursor-pointer select-none items-center gap-3 rounded-2xl border px-4 py-3 transition-all duration-200 active:scale-[0.99] ${urgencyRing[deadlineUrgency]} ${
          sheetSurface
            ? isIssue
              ? 'border-amber-200/90 bg-amber-50/95 shadow-sm hover:border-amber-300 hover:shadow-md'
              : isIncidentType
                ? 'border-rose-200/90 bg-rose-50/95 shadow-sm hover:border-rose-300 hover:shadow-md'
                : isMaintenance
                  ? 'border-blue-200/90 bg-blue-50/95 shadow-sm hover:border-blue-300 hover:shadow-md'
                  : isGeneral
                    ? 'border-slate-200/90 bg-slate-50/95 shadow-sm hover:border-slate-300 hover:shadow-md'
                    : 'border-slate-200/90 bg-white shadow-sm hover:border-teal-300/70 hover:shadow-md'
            : isIssue
              ? 'border-amber-300/90 bg-amber-50/90 shadow-md shadow-slate-900/5 hover:border-amber-400/80 hover:shadow-lg dark:border-amber-500/50 dark:bg-amber-950/40'
              : isIncidentType
                ? 'border-rose-300/90 bg-rose-50/90 shadow-md shadow-slate-900/5 hover:border-rose-400/80 hover:shadow-lg dark:border-rose-500/50 dark:bg-rose-950/40'
                : isMaintenance
                  ? 'border-blue-300/90 bg-blue-50/90 shadow-md shadow-slate-900/5 hover:border-blue-400/80 hover:shadow-lg dark:border-blue-500/50 dark:bg-blue-950/40'
                  : isGeneral
                    ? 'border-slate-300/90 bg-slate-50/90 shadow-md shadow-slate-900/5 hover:border-slate-400/80 hover:shadow-lg dark:border-slate-600/80 dark:bg-slate-800/60'
                    : 'border-slate-200/90 bg-white shadow-md shadow-slate-900/5 hover:border-teal-200/80 hover:shadow-lg dark:border-slate-700/80 dark:bg-slate-900'
        }`}
      >
        <span
          className="flex shrink-0 flex-col items-center"
          onClick={(e) => e.stopPropagation()}
          title={str.tasks.checklist.markDoneCheckboxAria}
        >
          <Checkbox
            checked={isDone}
            disabled={isDone}
            aria-label={`${str.tasks.checklist.markDoneCheckboxAria}. ${placeLabel}`}
            onCheckedChange={(checked) => {
              if (checked && !isDone) onMarkDone(task.uuid);
            }}
          />
        </span>

        <div className="min-w-0 flex-1">
          <p
            className={`truncate text-sm font-semibold ${isDone ? 'text-slate-400 line-through' : 'text-slate-900 dark:text-slate-100'}`}
          >
            {placeLabel}
          </p>
          {secondaryLine ? (
            <p className="truncate text-xs text-slate-500 dark:text-slate-400" title={secondaryLine}>
              {secondaryLine}
            </p>
          ) : null}
          <p className={`flex items-center gap-1.5 truncate text-xs ${
            isIncidentType ? 'text-rose-600 dark:text-rose-400 font-bold' :
            isMaintenance ? 'text-blue-600 dark:text-blue-400 font-bold' :
            isGeneral ? 'text-slate-700 dark:text-slate-300 font-bold' :
            'text-slate-600 dark:text-slate-400'
          }`}>
            {isIncidentType && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
            {isMaintenance && <Wrench className="h-3.5 w-3.5 shrink-0" />}
            {isGeneral && !isIncidentType && !isMaintenance && <ClipboardList className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">
              {typeLabels[task.type] ?? task.type}
              {task.contextLabel ? ` · ${task.contextLabel}` : ''}
            </span>
          </p>
          {isIssue ? (
            <p className="mt-1">
              <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">
                {str.tasks.taskStatusIssue}
              </span>
            </p>
          ) : null}
          {dueDayHint ? (
            <p className="mt-0.5 text-xs font-medium capitalize text-teal-700">{dueDayHint}</p>
          ) : null}
        </div>

        {showReportActions ? (
          <div
            className="relative z-20 flex shrink-0 flex-row items-center gap-2"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {onVoiceForTask ? (
              <button
                type="button"
                className={cardActionBtnClass}
                aria-label={str.tasks.checklist.cardVoiceAria}
                title={str.tasks.checklist.cardVoiceAria}
                onClick={(e) => {
                  e.stopPropagation();
                  onVoiceForTask(task);
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Mic className="h-5 w-5" strokeWidth={2.1} aria-hidden />
              </button>
            ) : null}
            {onTextForTask ? (
              <button
                type="button"
                className={cardActionBtnClass}
                aria-label={str.tasks.checklist.cardTextAria}
                title={str.tasks.checklist.cardTextAria}
                onClick={(e) => {
                  e.stopPropagation();
                  onTextForTask(task);
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Pencil className="h-5 w-5" strokeWidth={2.1} aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}

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
            <span className="h-2 w-2 rounded-full bg-rose-500 ring-2 ring-rose-200/80" title="Срочно" />
          )}
        </div>
      </div>
    </div>
  );
});
