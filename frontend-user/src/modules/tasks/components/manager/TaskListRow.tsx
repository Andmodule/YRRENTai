'use client';

import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { Clock, User, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import type { Task, TaskStatus } from '../../types';
import { TaskTypeBadge } from '../shared/TaskTypeBadge';

const STATUSES: TaskStatus[] = ['pending', 'in_progress', 'done', 'issue'];

export const TaskListRow = memo(function TaskListRow({
  task,
  onOpen,
  onStatusChange,
}: {
  task: Task;
  onOpen: (t: Task) => void;
  onStatusChange: (uuid: string, status: TaskStatus) => void;
}) {
  const t = useTranslations('tasks');
  const tStatus = useTranslations('tasks.status');

  const urgent = task.priority === 'urgent';
  const critical = task.priority === 'critical';

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'flex w-full min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-3 text-left shadow-sm transition-colors',
        'hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:gap-3',
      )}
      onClick={() => onOpen(task)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(task);
        }
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <TaskTypeBadge type={task.type} />
          <span className="flex items-center gap-1">
            {critical && <span className="h-2 w-2 rounded-full bg-red-600" title={t('priority.critical')} />}
            {urgent && !critical && <span className="h-2 w-2 rounded-full bg-amber-500" title={t('priority.urgent')} />}
          </span>
        </div>
        <p className="mt-1 truncate text-sm font-semibold text-foreground">{task.title || task.propertyTitle}</p>
        <p className="truncate text-xs text-muted-foreground">{task.propertyTitle}</p>
        {task.contextLabel && (
          <p className="line-clamp-1 text-xs text-muted-foreground">{task.contextLabel}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {task.dueTime && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              {task.dueTime}
            </span>
          )}
          <span className="inline-flex min-w-0 items-center gap-1">
            <User className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{task.assigneeName ?? t('unassigned')}</span>
          </span>
        </div>
      </div>

      <div
        className="flex shrink-0 items-center gap-2 sm:w-[min(100%,200px)]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <label className="sr-only" htmlFor={`task-status-${task.uuid}`}>
          {t('filters.status')}
        </label>
        <Select
          id={`task-status-${task.uuid}`}
          className="h-9 text-xs"
          value={task.status}
          onChange={(e) => onStatusChange(task.uuid, e.target.value as TaskStatus)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatus(s)}
            </option>
          ))}
        </Select>
        <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" aria-hidden />
      </div>
    </div>
  );
});
