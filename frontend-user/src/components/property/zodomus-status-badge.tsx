'use client';

import { useTranslations } from 'next-intl';
import type { ZodomusPropertyStatus } from '@rentai/shared';
import { cn } from '@/lib/utils';

const STATUS_CLASS: Record<ZodomusPropertyStatus, string> = {
  active:
    'bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  evaluation:
    'bg-amber-500/15 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  not_active:
    'bg-orange-500/15 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200',
  invalid: 'bg-destructive/15 text-destructive',
  error: 'bg-destructive/15 text-destructive',
  unknown: 'bg-muted text-muted-foreground',
};

interface ZodomusStatusBadgeProps {
  status?: ZodomusPropertyStatus | null;
  detail?: string | null;
  linked?: boolean;
  className?: string;
}

export function ZodomusStatusBadge({
  status,
  detail,
  linked = true,
  className,
}: ZodomusStatusBadgeProps) {
  const t = useTranslations('properties.zodomusStatus');

  if (!linked) {
    return (
      <span className={cn('text-[11px] text-muted-foreground/55', className)} title={t('unlinkedHint')}>
        {t('unlinked')}
      </span>
    );
  }

  const key = status ?? 'unknown';
  return (
    <span
      className={cn(
        'inline-flex max-w-full truncate rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        STATUS_CLASS[key],
        className,
      )}
      title={detail?.trim() || t(`${key}Hint`)}
    >
      {t(key)}
    </span>
  );
}
