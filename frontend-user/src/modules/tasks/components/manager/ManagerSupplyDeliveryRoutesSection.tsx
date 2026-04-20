'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useTasksFiltersStore } from '@/stores/tasks-filters.store';
import { useDeliveryRoutesList, type DeliveryRouteListItem } from '../../hooks/useDeliveryRoutes';

function DeliveryRouteRow({
  r,
  onOpen,
  statusClass,
  routeStatusLabel,
  t,
}: {
  r: DeliveryRouteListItem;
  onOpen: (id: string) => void;
  statusClass: (s: string) => string;
  routeStatusLabel: (s: string) => string;
  /** Переводы `tasks.managerSupply` */
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
    <li>
      <button
        type="button"
        className={cn(
          'flex w-full min-w-0 items-start gap-2 rounded-xl border bg-card p-3 text-left shadow-sm transition-colors',
          'hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          r.status === 'completed'
            ? 'border-emerald-500/40 bg-emerald-500/[0.06] dark:border-emerald-500/30 dark:bg-emerald-500/[0.08]'
            : 'border-border/60 dark:border-border/50',
        )}
        aria-label={t('matrixRouteOpenDetailAria')}
        onClick={() => onOpen(r.id)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'text-sm font-semibold',
                r.status === 'completed' ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground',
              )}
            >
              {t('deliveryRouteDateLabel', { date: r.scheduledDate })}
            </span>
            <Badge variant="secondary" className={statusClass(r.status)}>
              {routeStatusLabel(r.status)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {r.warehouseLabel ? `${r.warehouseLabel} · ` : ''}
            {t('deliveryRouteStopsCount', { count: r.stopsCount })}
            {r.driverName ? ` · ${r.driverName}` : ''}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 self-center whitespace-nowrap text-[11px] font-medium text-primary">
          {t('matrixRouteDetailsLabel')}
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
        </span>
      </button>
    </li>
  );
}

/** Список маршрутов для встраивания в сводку; детали открываются через `onOpenRouteDetail`. */
export function ManagerSupplyDeliveryRoutesSection({
  onOpenRouteDetail,
}: {
  onOpenRouteDetail: (routeId: string) => void;
}) {
  const t = useTranslations('tasks.managerSupply');
  const dateRange = useTasksFiltersStore((s) => s.filters.dateRange);
  const routeFrom = format(dateRange.start, 'yyyy-MM-dd');
  const routeTo = format(dateRange.end, 'yyyy-MM-dd');

  const { data: activeRoutes, isLoading, isError, refetch } = useDeliveryRoutesList(routeFrom, routeTo, {
    completion: 'active',
  });

  const [completedOpen, setCompletedOpen] = useState(false);
  const {
    data: completedRoutes,
    isLoading: completedLoading,
    isError: completedError,
    refetch: refetchCompleted,
  } = useDeliveryRoutesList(routeFrom, routeTo, {
    completion: 'completed',
    enabled: completedOpen,
  });

  const statusClass = (s: string) =>
    cn(
      'border text-[10px] font-semibold',
      s === 'draft' && 'border-border bg-muted text-foreground dark:bg-muted/60',
      s === 'assigned' && 'border-primary/35 bg-primary/10 text-primary dark:bg-primary/15',
      s === 'in_progress' && 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100',
      s === 'completed' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100',
    );

  const routeStatusLabel = (s: string) => t(`deliveryRouteStatus.${s}` as Parameters<typeof t>[0]);

  const sortedActive = useMemo(() => {
    if (!activeRoutes?.length) return [];
    return [...activeRoutes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [activeRoutes]);

  const sortedCompleted = useMemo(() => {
    if (!completedRoutes?.length) return [];
    return [...completedRoutes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [completedRoutes]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full rounded-lg" />
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive">
        {t('deliveryRoutesLoadError')}{' '}
        <button type="button" className="underline" onClick={() => void refetch()}>
          {t('retry')}
        </button>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold leading-tight tracking-tight text-foreground">{t('routesTab')}</h2>
        {sortedActive.length > 0 ? (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/75">
            {t('deliveryRoutesActiveSummary', { count: sortedActive.length })}
          </p>
        ) : null}
      </div>

      {!sortedActive.length ? (
        <p className="rounded-lg border border-dashed border-border/40 bg-muted/15 px-3 py-6 text-center text-sm text-muted-foreground">
          {t('deliveryRoutesEmpty')}
        </p>
      ) : (
        <ul className="space-y-2" role="list">
          {sortedActive.map((r) => (
            <DeliveryRouteRow
              key={r.id}
              r={r}
              onOpen={onOpenRouteDetail}
              statusClass={statusClass}
              routeStatusLabel={routeStatusLabel}
              t={t}
            />
          ))}
        </ul>
      )}

      <Collapsible open={completedOpen} onOpenChange={setCompletedOpen}>
        <CollapsibleTrigger
          type="button"
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-left text-sm font-medium text-foreground',
            'hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <span className="min-w-0">
            {completedOpen && completedLoading && completedRoutes == null
              ? t('deliveryRoutesCompletedLoading')
              : completedRoutes != null
                ? t('deliveryRoutesCompletedWithCount', { count: completedRoutes.length })
                : t('deliveryRoutesCompletedClosed')}
          </span>
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 transition-transform duration-200', completedOpen && 'rotate-180')}
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          {completedError ? (
            <p className="text-sm text-destructive">
              {t('deliveryRoutesLoadError')}{' '}
              <button type="button" className="underline" onClick={() => void refetchCompleted()}>
                {t('retry')}
              </button>
            </p>
          ) : completedLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
            </div>
          ) : !sortedCompleted.length ? (
            <p className="rounded-lg border border-dashed border-border/40 bg-muted/15 px-3 py-6 text-center text-sm text-muted-foreground">
              {t('deliveryRoutesCompletedEmpty')}
            </p>
          ) : (
            <ul className="space-y-2" role="list">
              {sortedCompleted.map((r) => (
                <DeliveryRouteRow
                  key={r.id}
                  r={r}
                  onOpen={onOpenRouteDetail}
                  statusClass={statusClass}
                  routeStatusLabel={routeStatusLabel}
                  t={t}
                />
              ))}
            </ul>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
