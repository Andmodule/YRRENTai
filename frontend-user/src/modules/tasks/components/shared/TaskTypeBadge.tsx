import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { ClipboardList, KeyRound, RefreshCw, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TaskType } from '../../types';

const typeIcons: Record<TaskType, LucideIcon> = {
  checkout_cleaning: Sparkles,
  checkin_prep: KeyRound,
  mid_stay_cleaning: RefreshCw,
  manual: ClipboardList,
};

export const TaskTypeBadge = memo(function TaskTypeBadge({ type }: { type: TaskType }) {
  const t = useTranslations('tasks.type');
  const Icon = typeIcons[type];
  const labelKey: Record<TaskType, string> = {
    checkout_cleaning: 'checkout_cleaning',
    checkin_prep: 'checkin_prep',
    mid_stay_cleaning: 'mid_stay_cleaning',
    manual: 'manual',
  };
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground dark:bg-muted/60">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {t(labelKey[type])}
    </span>
  );
});
