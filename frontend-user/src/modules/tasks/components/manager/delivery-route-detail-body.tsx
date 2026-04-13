'use client';

import type { Locale } from 'date-fns';
import { format, parseISO } from 'date-fns';
import { de, enUS, es, pl, ru } from 'date-fns/locale';
import { useLocale } from 'next-intl';
import { Loader2, MapPin, Package } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DeliveryRouteDetail } from '../../hooks/useDeliveryRoutes';

const DATE_LOCALES: Record<string, Locale> = {
  ru,
  en: enUS,
  de,
  es,
  pl,
};

export function routeStopStatusLabel(status: string, t: (key: string) => string): string {
  if (status === 'pending' || status === 'arrived' || status === 'done') {
    return t(`deliveryRouteStopStatus.${status}`);
  }
  return status;
}

export function routeStopStatusClass(status: string): string {
  return cn(
    'shrink-0 border text-[10px] font-semibold',
    status === 'done' &&
      'border-emerald-500/45 bg-emerald-500/12 text-emerald-800 dark:text-emerald-200',
    status === 'arrived' &&
      'border-blue-500/40 bg-blue-500/10 text-blue-800 dark:text-blue-200',
    status === 'pending' &&
      'border-slate-300/80 bg-slate-500/10 text-slate-700 dark:border-slate-600 dark:text-slate-300',
  );
}

export function DeliveryRouteDetailBody({
  detail,
  detailLoading,
  emptyLabel,
  t,
}: {
  detail: DeliveryRouteDetail | null | undefined;
  detailLoading: boolean;
  emptyLabel: string;
  t: (key: string) => string;
}) {
  const locale = useLocale();
  const dateLocale = DATE_LOCALES[locale] ?? enUS;

  const formatDeliveredAt = (iso: string) => {
    try {
      return format(parseISO(iso), 'dd.MM.yyyy · HH:mm', { locale: dateLocale });
    } catch {
      return iso;
    }
  };

  if (detailLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-8 w-8 animate-spin text-[#008CA4]" />
      </div>
    );
  }
  if (!detail) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <>
      <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
        <p className="text-xs font-semibold uppercase text-muted-foreground">{t('deliveryRoutePicking')}</p>
        <ul className="mt-2 space-y-1 text-sm">
          {detail.pickingLines.map((pl) => (
            <li key={`${pl.name}-${pl.quantity}`} className="flex gap-2">
              <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                {pl.name}{' '}
                <span className="text-muted-foreground">
                  {pl.quantity}
                  {pl.unit ? ` ${pl.unit}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase text-muted-foreground">{t('deliveryRouteStops')}</p>
        <ol className="mt-2 space-y-2">
          {detail.stops.map((s) => (
            <li
              key={s.id}
              className="flex flex-col rounded-lg border border-border/50 bg-card/80 p-2.5 text-sm"
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 font-mono text-xs text-muted-foreground">{s.sortOrder}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {s.kind === 'warehouse' ? t('deliveryRouteStopWarehouse') : s.propertyTitle ?? '—'}
                  </p>
                  {s.propertyAddress ? (
                    <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
                      <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                      {s.propertyAddress}
                    </p>
                  ) : null}
                  {s.lines.length > 0 ? (
                    <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                      {s.lines.map((ln) => (
                        <li key={ln.supplyRequestItemId}>
                          {ln.name}: {[ln.quantity, ln.unit].filter(Boolean).join(' ')}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <Badge variant="outline" className={routeStopStatusClass(s.status)}>
                  {routeStopStatusLabel(s.status, t)}
                </Badge>
              </div>
              {s.completedAt ? (
                <p className="mt-1.5 text-right text-[10px] tabular-nums text-muted-foreground/75">
                  {formatDeliveredAt(s.completedAt)}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
