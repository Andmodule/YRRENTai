'use client';

import { memo, useCallback, useRef, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { enUS, ru } from 'date-fns/locale';
import { ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useMatchMedia } from '@/hooks/use-match-media';
import { TaskListRowMobile } from '@/modules/tasks/components/manager/TaskListRowMobile';
import { usePatchIncident, type Incident } from '../hooks/useIncidents';
import { IncidentTypePill, INCIDENT_TYPE_LABEL_KEY } from './IncidentTypePill';
import {
  incidentListStatusDotClass,
  incidentStatusLabelKey,
  incidentStatusUi,
} from '../utils/incident-status-ui';

function reporterInitials(name: string | null | undefined): string {
  if (!name?.trim()) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0]?.[0];
    const b = parts[1]?.[0];
    if (a && b) return (a + b).toUpperCase();
  }
  return parts[0]!.slice(0, 2).toUpperCase();
}

export const IncidentListRow = memo(function IncidentListRow({
  incident,
  onOpen,
  swipeOpenRowId,
  onSwipeRowOpenChange,
  hidePropertyContext = false,
  className,
  onSwipeCloseIncident,
}: {
  incident: Incident;
  onOpen: (i: Incident) => void;
  swipeOpenRowId: string | null;
  onSwipeRowOpenChange: (id: string | null) => void;
  /** Hide property line when the row is already under that property’s group header. */
  hidePropertyContext?: boolean;
  className?: string;
  /** Mobile: deferred close after swipe + undo toast (if omitted, PATCH runs immediately). */
  onSwipeCloseIncident?: (i: Incident) => void;
}) {
  const tCard = useTranslations('tasks.kanban.incidentCard');
  const tList = useTranslations('tasks.listByProperty');
  const locale = useLocale();
  const dfLocale = locale === 'ru' ? ru : enUS;
  const isMdUp = useMatchMedia('(min-width: 768px)');
  const { mutate: patchIncident } = usePatchIncident();
  const suppressRowClickRef = useRef(false);

  const titleDisplay = incident.description.trim()
    ? incident.description.trim()
    : tCard(INCIDENT_TYPE_LABEL_KEY[incident.type]);

  const contextLabel =
    hidePropertyContext ? null : incident.propertyTitle?.trim() || null;

  const dateLabel = (() => {
    try {
      return format(new Date(incident.createdAt), 'd MMM', { locale: dfLocale });
    } catch {
      return '—';
    }
  })();

  const statusKey = incidentStatusLabelKey(incident.status);
  const statusDot = (
    <span
      className={cn('h-2.5 w-2.5 shrink-0 rounded-full shadow-sm', incidentListStatusDotClass(incident.status))}
      title={tCard(statusKey)}
      aria-hidden
    />
  );

  const onRowKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const target = e.target as HTMLElement;
        if (target.closest('button, input, select, textarea, a')) return;
        e.preventDefault();
        onOpen(incident);
      }
    },
    [onOpen, incident],
  );

  const openRow = useCallback(() => {
    onOpen(incident);
  }, [onOpen, incident]);

  const canSwipe =
    !isMdUp &&
    (incident.status === 'awaiting_dispatch' ||
      incident.status === 'assigned' ||
      incident.status === 'open' ||
      incident.status === 'in_review');

  /** Same close action: swipe right «Готово» (as tasks) or trash after left-swipe peek */
  const closeIncidentBySwipe = useCallback(() => {
    if (onSwipeCloseIncident) {
      onSwipeCloseIncident(incident);
      return;
    }
    patchIncident(
      { uuid: incident.uuid, status: 'resolved' },
      {
        onError: () => toast.error(tList('incidentSwipeError')),
      },
    );
  }, [incident, onSwipeCloseIncident, patchIncident, tList]);

  const statusUi = incidentStatusUi(incident.status);

  const rowClassName = cn(
    'flex w-full min-w-0 cursor-pointer flex-row items-start gap-2 border-b border-border/40 px-2 py-2 text-left transition-colors md:px-3',
    'hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    'bg-rose-50/50 hover:bg-rose-100/50 dark:bg-rose-950/20 dark:hover:bg-rose-950/40',
    className,
  );

  const rowInner = (
    <>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        {statusDot}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
        <span className="truncate text-sm font-normal leading-tight text-foreground">{titleDisplay}</span>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <IncidentTypePill type={incident.type} />
          <span
            className={cn(
              'inline-flex items-center rounded px-1.5 py-px text-[9px] font-medium',
              statusUi.pill,
            )}
          >
            {tCard(statusKey)}
          </span>
          {contextLabel ? (
            <span className="min-w-0 truncate text-[9px] leading-tight text-muted-foreground/75">{contextLabel}</span>
          ) : null}
        </div>
      </div>

      <div
        className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5 text-[10px] tabular-nums text-muted-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1">
          {incident.photoUrls?.length > 0 ? (
            <span title={tCard('hasPhotos')} className="text-muted-foreground/70">
              <ImageIcon className="h-2.5 w-2.5" aria-hidden />
            </span>
          ) : null}
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground"
            title={incident.reporterName ?? tList('incidentReporterFallback')}
          >
            {reporterInitials(incident.reporterName)}
          </span>
        </div>
        <span className="whitespace-nowrap text-[9px] font-normal tabular-nums text-muted-foreground/70">{dateLabel}</span>
      </div>
    </>
  );

  if (!isMdUp && canSwipe) {
    return (
      <TaskListRowMobile
        rowId={`inc-${incident.uuid}`}
        swipeOpenRowId={swipeOpenRowId}
        onSwipeRowOpenChange={onSwipeRowOpenChange}
        rowClassName={rowClassName}
        canSwipeRightDone
        canSwipeLeftDelete
        onSwipeRightDone={closeIncidentBySwipe}
        onSwipeDeleteAnimationEnd={closeIncidentBySwipe}
        doneRevealLabel={tList('swipeRevealLabel')}
        deleteRevealLabel={tList('incidentSwipeDismissLabel')}
        ariaRow={`${titleDisplay}. ${tList('incidentSwipeToResolveAria')} ${tList('incidentSwipeToDismissAria')}`}
        suppressRowClickRef={suppressRowClickRef}
        onRowClick={openRow}
        onRowKeyDown={onRowKeyDown}
      >
        {rowInner}
      </TaskListRowMobile>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={rowClassName}
      onClick={() => onOpen(incident)}
      onKeyDown={onRowKeyDown}
    >
      {rowInner}
    </div>
  );
});
