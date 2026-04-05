import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { TaskStatus } from '../../types';

export const TaskStatusBadge = memo(function TaskStatusBadge({
  status,
  size = 'md',
}: {
  status: TaskStatus;
  size?: 'sm' | 'md';
}) {
  const t = useTranslations('tasks.status');
  const config: Record<TaskStatus, string> = {
    pending: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300',
    in_progress: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/80 dark:text-cyan-300',
    done: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
    issue: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  };
  const labelKey: Record<TaskStatus, string> = {
    pending: 'pending',
    in_progress: 'in_progress',
    done: 'done',
    issue: 'issue',
  };
  return (
    <span
      className={cn(
        'inline-flex rounded-full font-medium',
        size === 'sm' ? 'px-1.5 py-px text-[10px]' : 'px-2 py-0.5 text-xs',
        config[status],
      )}
    >
      {t(labelKey[status])}
    </span>
  );
});
