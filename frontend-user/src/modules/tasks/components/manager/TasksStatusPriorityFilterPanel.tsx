'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useTasksFiltersStore } from '@/stores/tasks-filters.store';
import type { TaskFilters, TaskPriority, TaskStatus } from '../../types';
import { tasksChipActiveClasses, tasksChipIdleClasses } from '../../tasks-chip-classes';

const STATUSES: (TaskStatus | 'all')[] = ['all', 'pending', 'in_progress', 'done'];
const PRIORITIES: (TaskPriority | 'all')[] = ['all', 'urgent', 'normal'];

export function isTasksListSliceFiltered(f: Pick<TaskFilters, 'statusFilter' | 'priorityFilter'>): boolean {
  return f.statusFilter !== 'all' || f.priorityFilter !== 'all';
}

/** Статус и приоритет списка/канбана — общая панель для шапки (десктоп) и sheet (мобайл). */
export function TasksStatusPriorityFilterPanel({ className }: { className?: string }) {
  const t = useTranslations('tasks');
  const tStatus = useTranslations('tasks.status');
  const tPriority = useTranslations('tasks.priority');
  const filters = useTasksFiltersStore((s) => s.filters);
  const setFilters = useTasksFiltersStore((s) => s.setFilters);

  const chipBase =
    'inline-flex shrink-0 items-center justify-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-colors duration-150';

  const sliceFiltered = isTasksListSliceFiltered(filters);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('filters.status')}
        </p>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('filters.status')}>
          {STATUSES.map((s) => {
            const active = filters.statusFilter === s;
            const label = s === 'all' ? t('filters.all') : tStatus(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() =>
                  setFilters((prev) => ({
                    ...prev,
                    statusFilter: prev.statusFilter === s && s !== 'all' ? 'all' : s,
                  }))
                }
                className={cn(chipBase, active ? tasksChipActiveClasses : tasksChipIdleClasses)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('filters.priority')}
        </p>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('filters.priority')}>
          {PRIORITIES.map((p) => {
            const active = filters.priorityFilter === p;
            const label = p === 'all' ? t('filters.all') : tPriority(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() =>
                  setFilters((prev) => ({
                    ...prev,
                    priorityFilter: prev.priorityFilter === p && p !== 'all' ? 'all' : p,
                  }))
                }
                className={cn(chipBase, active ? tasksChipActiveClasses : tasksChipIdleClasses)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-full shrink-0 text-xs font-medium"
        onClick={() =>
          setFilters((prev) => ({
            ...prev,
            statusFilter: 'all',
            priorityFilter: 'all',
          }))
        }
        disabled={!sliceFiltered}
      >
        {t('filters.listFilterReset')}
      </Button>
    </div>
  );
}
