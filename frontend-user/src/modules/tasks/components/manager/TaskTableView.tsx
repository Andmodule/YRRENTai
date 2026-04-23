'use client';

import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import type { Task, TaskStatus } from '../../types';
import { isTaskOverdue } from '../../utils/task-deadline';
import { TaskTypeBadge } from '../shared/TaskTypeBadge';

const STATUSES: TaskStatus[] = ['pending', 'in_progress', 'done', 'issue'];

export const TaskTableView = memo(function TaskTableView({
  tasks,
  onOpenTask,
  onStatusChange,
}: {
  tasks: Task[];
  onOpenTask: (t: Task) => void;
  onStatusChange: (uuid: string, status: TaskStatus) => void;
}) {
  const t = useTranslations('tasks');
  const tStatus = useTranslations('tasks.status');
  const tTable = useTranslations('tasks.viewTable');
  const tKanban = useTranslations('tasks.kanban');

  if (tasks.length === 0) return null;

  return (
    <div className="w-full min-w-0 overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
            <th className="px-3 py-2.5">{tTable('type')}</th>
            <th className="px-3 py-2.5">{tTable('task')}</th>
            <th className="px-3 py-2.5">{tTable('property')}</th>
            <th className="px-3 py-2.5">{tTable('status')}</th>
            <th className="px-3 py-2.5">{tTable('due')}</th>
            <th className="px-3 py-2.5">{tTable('assignee')}</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr
              key={task.uuid}
              className={cn(
                'border-b border-border/80 transition-colors last:border-0',
                'hover:bg-muted/30',
                isTaskOverdue(task) && 'bg-amber-500/[0.06] dark:bg-amber-500/[0.07]',
              )}
            >
              <td
                className={cn(
                  'px-3 py-2 align-middle',
                  isTaskOverdue(task) && 'border-l-[3px] border-l-amber-600/30 dark:border-l-amber-500/40',
                )}
              >
                <TaskTypeBadge type={task.type} />
              </td>
              <td className="px-3 py-2 align-middle">
                <div className="flex min-w-0 max-w-[260px] items-center gap-1.5">
                  <button
                    type="button"
                    className="min-w-0 truncate text-left font-medium text-primary hover:underline"
                    onClick={() => onOpenTask(task)}
                  >
                    {task.title || task.propertyTitle}
                  </button>
                  {task.incidentId ? (
                    <span
                      className="inline-flex shrink-0 text-muted-foreground"
                      title={tKanban('taskFromIncidentBadge')}
                      aria-label={tKanban('taskFromIncidentBadge')}
                    >
                      <Link2 className="h-3.5 w-3.5" aria-hidden />
                    </span>
                  ) : null}
                </div>
              </td>
              <td className="max-w-[200px] truncate px-3 py-2 align-middle text-muted-foreground">
                {task.propertyTitle}
              </td>
              <td className="px-3 py-2 align-middle" onClick={(e) => e.stopPropagation()}>
                <Select
                  className="h-9 min-w-[140px] text-xs"
                  value={task.status}
                  onChange={(e) => onStatusChange(task.uuid, e.target.value as TaskStatus)}
                  aria-label={tTable('statusChangeAria', { title: task.title || task.propertyTitle })}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {tStatus(s)}
                    </option>
                  ))}
                </Select>
              </td>
              <td className="whitespace-nowrap px-3 py-2 align-middle text-muted-foreground">
                {task.dueTime ?? '—'}
              </td>
              <td className="max-w-[160px] truncate px-3 py-2 align-middle text-muted-foreground">
                {task.assigneeName ?? t('unassigned')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
