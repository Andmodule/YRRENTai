import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { Sparkles, KeyRound, RefreshCw, Wrench, MoreHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskType } from '../../types';

const typeIcons: Record<TaskType, LucideIcon> = {
  checkout_cleaning: Sparkles,
  checkin_prep: KeyRound,
  mid_stay_cleaning: RefreshCw,
  maintenance: Wrench,
  other: MoreHorizontal,
};

export const TaskTypeBadge = memo(function TaskTypeBadge({
  type,
  className,
  variant = 'default',
}: {
  type: string;
  className?: string;
  variant?: 'default' | 'dense';
}) {
  const t = useTranslations('tasks.type');
  const Icon = typeIcons[type as TaskType] ?? MoreHorizontal;
  const labelKey = type in typeIcons ? type : 'other';

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 border border-border bg-background font-medium text-foreground dark:bg-muted/60',
        variant === 'dense'
          ? 'rounded-full px-1.5 py-0.5 text-[10px] leading-tight'
          : 'gap-1 rounded-md px-2 py-0.5 text-xs',
        className,
      )}
    >
      <Icon
        className={cn('shrink-0 opacity-90', variant === 'dense' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5')}
        aria-hidden
      />
      {t(labelKey)}
    </span>
  );
});
