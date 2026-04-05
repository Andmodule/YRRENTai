'use client';

import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { TaskType } from '../../types';

/** Low-contrast list meta — not competing with the task title. */
const TYPE_CLASS: Record<TaskType, string> = {
  checkout_cleaning: 'border-orange-500/15 bg-orange-500/5 text-orange-700/80 dark:text-orange-200/55',
  checkin_prep: 'border-emerald-500/15 bg-emerald-500/5 text-emerald-800/75 dark:text-emerald-200/55',
  mid_stay_cleaning: 'border-amber-500/12 bg-amber-500/5 text-amber-900/65 dark:text-amber-200/50',
  maintenance: 'border-border/50 bg-muted/40 text-muted-foreground',
  other: 'border-border/40 bg-muted/30 text-muted-foreground/90',
};

export const TaskListTypePill = memo(function TaskListTypePill({
  type,
  className,
}: {
  type: TaskType;
  className?: string;
}) {
  const t = useTranslations('tasks.listByProperty.typePill');

  const label =
    type === 'checkout_cleaning'
      ? t('checkout')
      : type === 'checkin_prep'
        ? t('checkin')
        : type === 'mid_stay_cleaning'
          ? t('midStay')
          : type === 'maintenance'
            ? t('maintenance')
            : t('other');

  return (
    <span
      className={cn(
        'inline-flex max-w-full shrink-0 items-center rounded-full border px-1.5 py-px text-[9px] font-normal leading-tight',
        TYPE_CLASS[type] ?? TYPE_CLASS.other,
        className,
      )}
    >
      {label}
    </span>
  );
});
