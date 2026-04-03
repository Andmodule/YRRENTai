'use client';

import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import type { Task, TaskStatus } from '../../types';
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
              )}
            >
              <td className="px-3 py-2 align-middle">
                <TaskTypeBadge type={task.type} />
              </td>
              <td className="px-3 py-2 align-middle">
                <button
                  type="button"
                  className="max-w-[220px] truncate text-left font-medium text-primary hover:underline"
                  onClick={() => onOpenTask(task)}
                >
                  {task.title || task.propertyTitle}
                </button>
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
