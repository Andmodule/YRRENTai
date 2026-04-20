'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { TaskFilters, TaskPriority, TaskStatus } from '../../types';
import { tasksChipActiveClasses, tasksChipIdleClasses } from '../../tasks-chip-classes';

const STATUSES: (TaskStatus | 'all')[] = ['all', 'pending', 'in_progress', 'done'];
const PRIORITIES: (TaskPriority | 'all')[] = ['all', 'urgent', 'normal'];

export function TasksFiltersBar({
  filters,
  onFiltersChange,
}: {
  filters: TaskFilters;
  onFiltersChange: (f: TaskFilters | ((prev: TaskFilters) => TaskFilters)) => void;
}) {
  const t = useTranslations('tasks');
  const tStatus = useTranslations('tasks.status');
  const tPriority = useTranslations('tasks.priority');

  const chipBase =
    'inline-flex shrink-0 items-center justify-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-colors duration-150';
  const chipActive = tasksChipActiveClasses;
  const chipIdle = tasksChipIdleClasses;

  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-row items-center gap-1 overflow-x-auto whitespace-nowrap no-scrollbar',
        /* Мобайл / планшет: больше воздуха сверху и снизу; от lg — компактнее под десктоп */
        'py-2.5 pl-4 pr-[max(0.75rem,env(safe-area-inset-right,0px))] sm:px-4 lg:py-1.5',
      )}
    >
        {STATUSES.map((s) => {
          const active = filters.statusFilter === s;
          const label = s === 'all' ? t('filters.all') : tStatus(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() =>
                onFiltersChange((prev) => ({
                  ...prev,
                  statusFilter: prev.statusFilter === s && s !== 'all' ? 'all' : s,
                }))
              }
              className={cn(chipBase, active ? chipActive : chipIdle)}
            >
              {label}
            </button>
          );
        })}
        <div className="h-4 w-px shrink-0 bg-border" aria-hidden />
        {PRIORITIES.map((p) => {
          const active = filters.priorityFilter === p;
          const label = p === 'all' ? t('filters.all') : tPriority(p);
          return (
            <button
              key={p}
              type="button"
              onClick={() =>
                onFiltersChange((prev) => ({
                  ...prev,
                  priorityFilter: prev.priorityFilter === p && p !== 'all' ? 'all' : p,
                }))
              }
              className={cn(chipBase, active ? chipActive : chipIdle)}
            >
              {label}
            </button>
          );
        })}
        <div className="min-w-3 shrink-0 sm:min-w-0" aria-hidden />
    </div>
  );
}
