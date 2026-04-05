'use client';

import { memo, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ImageIcon, Wrench } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { Incident } from '../hooks/useIncidents';
import { INCIDENT_TYPE_LABEL_KEY } from './IncidentTypePill';
import { incidentStatusLabelKey, incidentStatusUi } from '../utils/incident-status-ui';

export const IncidentKanbanCard = memo(function IncidentKanbanCard({
  incident,
  onOpen,
}: {
  incident: Incident;
  onOpen: (i: Incident) => void;
}) {
  const t = useTranslations('tasks.kanban.incidentCard');
  const ui = useMemo(() => incidentStatusUi(incident.status), [incident.status]);
  const statusKey = incidentStatusLabelKey(incident.status);

  const created = format(new Date(incident.createdAt), 'd MMM HH:mm', { locale: ru });

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'rounded-xl border border-border/70 bg-card p-3 text-card-foreground shadow-sm transition-shadow duration-200',
        ui.strip,
        'cursor-pointer hover:shadow-md dark:shadow-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
          <Badge variant="destructive" className="text-[10px] font-semibold uppercase tracking-wide">
            🚨 {t('badge')}: {t(INCIDENT_TYPE_LABEL_KEY[incident.type])}
          </Badge>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
              ui.pill,
            )}
          >
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', ui.dot)} aria-hidden />
            {t(statusKey)}
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
      {incident.dispatchedAssigneeName?.trim() ? (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-cyan-800 dark:text-cyan-200/90">
          <Wrench className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {t('resolvingBy')}: {incident.dispatchedAssigneeName.trim()}
          </span>
        </p>
      ) : null}
      <p className="mt-2 text-[11px] text-muted-foreground">{created}</p>
    </div>
  );
});
