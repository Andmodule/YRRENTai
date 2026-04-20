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
    pending: 'bg-muted text-muted-foreground dark:bg-muted/80 dark:text-muted-foreground',
    in_progress: 'bg-primary/15 text-primary dark:bg-primary/20 dark:text-primary',
    done: 'bg-emerald-500/12 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300',
    issue: 'bg-destructive/12 text-destructive dark:bg-destructive/20 dark:text-destructive',
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
