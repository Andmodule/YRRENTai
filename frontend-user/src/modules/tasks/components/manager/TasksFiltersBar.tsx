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

  /** Dashboard / strategy CTA: cyan → violet (same as `dashboard/page` empty-state button). */
  const chipBase =
    'inline-flex shrink-0 items-center justify-center rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all duration-150';
  const chipActive =
    'border-transparent bg-gradient-to-r from-cyan-600 to-violet-600 text-white shadow-sm hover:from-cyan-500 hover:to-violet-500 dark:shadow-[0_1px_14px_-3px_rgba(34,211,238,0.45)]';
  const chipIdle =
    'border-slate-200/90 bg-white/95 text-slate-600 shadow-sm ring-1 ring-slate-900/[0.04] hover:border-slate-300/90 hover:bg-slate-50 dark:border-slate-600/55 dark:bg-slate-900/55 dark:text-slate-300 dark:ring-cyan-500/10 dark:hover:bg-slate-800/90';

  return (
    <div className="flex flex-row items-center gap-1 overflow-x-auto whitespace-nowrap pb-0.5 no-scrollbar">
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
    </div>
  );
}
