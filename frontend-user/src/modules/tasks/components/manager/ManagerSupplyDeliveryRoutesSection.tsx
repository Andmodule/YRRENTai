'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useDeliveryRoutesList } from '../../hooks/useDeliveryRoutes';

/** Список маршрутов для встраивания в сводку; детали открываются через `onOpenRouteDetail`. */
export function ManagerSupplyDeliveryRoutesSection({
  onOpenRouteDetail,
}: {
  onOpenRouteDetail: (routeId: string) => void;
}) {
  const t = useTranslations('tasks.managerSupply');
  const { data: routes, isLoading, isError, refetch } = useDeliveryRoutesList();

  const statusClass = (s: string) =>
    cn(
      'text-[10px] font-semibold',
      s === 'draft' && 'border-slate-400/40 bg-slate-500/10 text-slate-800 dark:text-slate-200',
      s === 'assigned' && 'border-[#008CA4]/35 bg-[#E0F2F5]/90 text-[#006a7a] dark:bg-[#00d4ff]/12 dark:text-[#a5f3fc]',
      s === 'in_progress' && 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100',
      s === 'completed' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100',
    );

  const routeStatusLabel = (s: string) => t(`deliveryRouteStatus.${s}` as Parameters<typeof t>[0]);

  const sortedRoutes = useMemo(() => {
    if (!routes?.length) return [];
    return [...routes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [routes]);

  const completedCount = useMemo(
    () => sortedRoutes.filter((r) => r.status === 'completed').length,
    [sortedRoutes],
  );

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
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold leading-tight tracking-tight text-foreground">{t('routesTab')}</h2>
        {sortedRoutes.length > 0 ? (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/75">
            {t('deliveryRoutesSummaryLine', { completed: completedCount, total: sortedRoutes.length })}
          </p>
        ) : null}
      </div>

      {!sortedRoutes.length ? (
        <p className="rounded-lg border border-dashed border-border/40 bg-muted/15 px-3 py-6 text-center text-sm text-muted-foreground">
          {t('deliveryRoutesEmpty')}
        </p>
      ) : (
        <ul className="space-y-2" role="list">
          {sortedRoutes.map((r) => (
            <li key={r.id}>
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
                onClick={() => onOpenRouteDetail(r.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'text-sm font-semibold',
                        r.status === 'completed'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-foreground',
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
                <span className="inline-flex shrink-0 items-center gap-1 self-center whitespace-nowrap text-[11px] font-medium text-[#008CA4] dark:text-[#7ee8ff]">
                  {t('matrixRouteDetailsLabel')}
                  <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
