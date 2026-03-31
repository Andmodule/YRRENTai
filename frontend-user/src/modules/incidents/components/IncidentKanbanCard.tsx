'use client';

import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Package, ImageIcon } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { Incident } from '../hooks/useIncidents';

export const IncidentKanbanCard = memo(function IncidentKanbanCard({
  incident,
  onOpen,
}: {
  incident: Incident;
  onOpen: (i: Incident) => void;
}) {
  const t = useTranslations('tasks.kanban.incidentCard');

  const isDamage = incident.type === 'damage';
  const created = format(new Date(incident.createdAt), 'd MMM HH:mm', { locale: ru });

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'rounded-xl border border-amber-500/35 bg-card p-3 text-card-foreground shadow-sm transition-shadow duration-200',
        'cursor-pointer hover:border-amber-500/55 hover:shadow-md dark:shadow-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50',
      )}
      onClick={() => onOpen(incident)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(incident);
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              'border border-amber-600/40 bg-amber-500/10 text-amber-900 dark:text-amber-100',
            )}
          >
            {t('badge')}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
              isDamage ? 'bg-destructive/15 text-destructive' : 'bg-secondary text-secondary-foreground',
            )}
            title={isDamage ? t('typeDamage') : t('typeLost')}
          >
            {isDamage ? <AlertTriangle className="h-3 w-3" aria-hidden /> : <Package className="h-3 w-3" aria-hidden />}
            {isDamage ? t('typeDamage') : t('typeLost')}
          </span>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-medium',
              incident.status === 'open'
                ? 'bg-orange-100 text-orange-900 dark:bg-orange-950/80 dark:text-orange-200'
                : 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
            )}
          >
            {incident.status === 'open' ? t('statusOpen') : t('statusReview')}
          </span>
        </div>
        {incident.photoUrls?.length > 0 && (
          <span title={t('hasPhotos')} className="text-muted-foreground">
            <ImageIcon className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>
      <p className="mt-2 text-sm font-semibold text-foreground">{incident.propertyTitle}</p>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{incident.description}</p>
      <p className="mt-2 text-[11px] text-muted-foreground">{created}</p>
    </div>
  );
});
