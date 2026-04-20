'use client';

import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Package, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PendingSupplyInterpretationEvent } from '../../types';

export const SupplyShortageListRow = memo(function SupplyShortageListRow({
  event,
  onOpen,
  variant = 'supply',
}: {
  event: PendingSupplyInterpretationEvent;
  onOpen: (event: PendingSupplyInterpretationEvent) => void;
  variant?: 'supply' | 'incident';
}) {
  const t = useTranslations('tasks.listByProperty');
  const preview =
    event.textRaw.length > 140 ? `${event.textRaw.slice(0, 137).trim()}…` : event.textRaw;
  const itemsPreview = event.items
    .slice(0, 2)
    .map((i) => i.name)
    .filter(Boolean)
    .join(', ');

  const isIncident = variant === 'incident';

  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      className={cn(
        'flex w-full min-w-0 items-start gap-3 border-b border-border/50 px-3 py-3 text-left transition-colors',
        isIncident
          ? 'border-l-2 border-l-amber-500/55 bg-amber-500/[0.06] hover:bg-amber-500/[0.1] dark:border-l-amber-400/50 dark:bg-amber-500/[0.08] dark:hover:bg-amber-500/[0.12]'
          : 'border-l-2 border-l-primary/50 bg-primary/[0.05] hover:bg-primary/[0.09] dark:border-l-primary/45 dark:bg-primary/[0.08] dark:hover:bg-primary/[0.12]',
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
          isIncident
            ? 'bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
            : 'bg-primary/12 text-primary dark:bg-primary/15',
        )}
      >
        {isIncident ? (
          <AlertTriangle className="h-4 w-4" aria-hidden />
        ) : (
          <Package className="h-4 w-4" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{event.propertyTitle}</p>
        <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{preview}</p>
        {itemsPreview ? (
          <p
            className={cn(
              'mt-1 text-[11px] font-medium',
              isIncident ? 'text-amber-700 dark:text-amber-300' : 'text-primary',
            )}
          >
            {t('shortageItemsPreview', { items: itemsPreview })}
          </p>
        ) : null}
      </div>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
});
