import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { TaskStatus } from '../../types';

export const TaskStatusBadge = memo(function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const t = useTranslations('tasks.status');
  const config: Record<TaskStatus, string> = {
    pending: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300',
    in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
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
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', config[status])}>
      {t(labelKey[status])}
    </span>
  );
});
