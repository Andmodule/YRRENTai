'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { TaskFilters, TaskPriority, TaskStatus } from '../../types';

const STATUSES: (TaskStatus | 'all')[] = ['all', 'pending', 'in_progress', 'done', 'issue'];
const PRIORITIES: (TaskPriority | 'all')[] = ['all', 'critical', 'urgent', 'normal'];

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
  /** Selected: палитра как у иконки (teal #008CA4, светлый фон/обводка #E0F2F5 / #D1EBF1) */
  const chipActive =
    'border-[#D1EBF1] bg-[#E0F2F5] text-[#008CA4] shadow-sm font-semibold dark:border-[#00d4ff]/40 dark:bg-[#00d4ff]/14 dark:text-[#a5f3fc] dark:font-semibold';
  const chipIdle =
    'border-slate-200 bg-white text-slate-600 shadow-sm hover:border-slate-300 hover:bg-slate-50 dark:border-slate-600/55 dark:bg-slate-900/55 dark:text-slate-300 dark:hover:bg-slate-800/90';

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
        <div className="h-4 w-px shrink-0 bg-slate-200/90 dark:bg-slate-600/55" aria-hidden />
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
