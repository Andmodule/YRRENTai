import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { Sparkles, KeyRound, RefreshCw, Wrench, MoreHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TaskType } from '../../types';

const typeIcons: Record<TaskType, LucideIcon> = {
  checkout_cleaning: Sparkles,
  checkin_prep: KeyRound,
  mid_stay_cleaning: RefreshCw,
  maintenance: Wrench,
  other: MoreHorizontal,
};

export const TaskTypeBadge = memo(function TaskTypeBadge({ type }: { type: string }) {
  const t = useTranslations('tasks.type');
  const Icon = typeIcons[type as TaskType] ?? MoreHorizontal;
  const labelKey = type in typeIcons ? type : 'other';

  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground dark:bg-muted/60">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {t(labelKey)}
    </span>
  );
});
