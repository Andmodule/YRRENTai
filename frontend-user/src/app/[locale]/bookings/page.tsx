'use client';

import { useEffect, useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Building2, CalendarDays } from 'lucide-react';
import { useProperties } from '@/hooks/use-properties';
import { useBookings } from '@/hooks/use-bookings';
import { useUiStore } from '@/stores/ui.store';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

function bookingStatusLabel(
  t: ReturnType<typeof useTranslations<'bookings'>>,
  status: string,
): string {
  switch (status) {
    case 'PENDING':
      return t('statusLabels.PENDING');
    case 'CONFIRMED':
      return t('statusLabels.CONFIRMED');
    case 'CHECKED_IN':
      return t('statusLabels.CHECKED_IN');
    case 'CHECKED_OUT':
      return t('statusLabels.CHECKED_OUT');
    case 'CANCELLED':
      return t('statusLabels.CANCELLED');
    case 'DECLINED':
      return t('statusLabels.DECLINED');
    case 'NO_SHOW':
      return t('statusLabels.NO_SHOW');
    default:
      return status;
  }
}

function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export default function BookingsPage() {
  const t = useTranslations('bookings');
  const locale = useLocale();
  const { properties, isLoading: propertiesLoading, isError: propertiesError, mutate: mutateProperties } =
    useProperties();
  const { activePropertyId, setActivePropertyId } = useUiStore();

  useEffect(() => {
    if (!activePropertyId && properties.length > 0 && properties[0]) {
      setActivePropertyId(properties[0].id);
    }
  }, [activePropertyId, properties, setActivePropertyId]);

  const { bookings, isLoading: bookingsLoading, isError: bookingsError, mutate } = useBookings(
    activePropertyId ?? null,
  );

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [locale],
  );

  if (propertiesError) {
    return <ErrorState onRetry={() => mutateProperties()} />;
  }

  if (propertiesLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div className="mx-auto max-w-5xl">
        <EmptyState
          icon={<Building2 className="h-12 w-12" />}
          title={t('noProperties')}
          description={t('noPropertiesHint')}
          action={
            <Button asChild>
              <Link href="/properties">{t('goToProperties')}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
        </div>
        <Select
          value={activePropertyId ?? ''}
          onChange={(e) => setActivePropertyId(e.target.value)}
          className="w-auto min-w-[200px]"
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>

      {bookingsError ? (
        <ErrorState onRetry={() => mutate()} />
      ) : bookingsLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : bookings.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="h-12 w-12" />}
          title={t('empty')}
          description={t('emptyHint')}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 font-medium">{t('guest')}</th>
                <th className="px-4 py-3 font-medium">{t('checkIn')}</th>
                <th className="px-4 py-3 font-medium">{t('checkOut')}</th>
                <th className="px-4 py-3 font-medium">{t('status')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('total')}</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{b.guestName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{dateFmt.format(new Date(b.checkIn))}</td>
                  <td className="px-4 py-3 text-muted-foreground">{dateFmt.format(new Date(b.checkOut))}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                        b.status === 'CONFIRMED' && 'bg-green-100 text-green-800',
                        b.status === 'PENDING' && 'bg-amber-100 text-amber-800',
                        b.status === 'CANCELLED' && 'bg-red-100 text-red-800',
                        b.status === 'CHECKED_IN' && 'bg-blue-100 text-blue-800',
                        b.status === 'CHECKED_OUT' && 'bg-slate-100 text-slate-800',
                        b.status === 'DECLINED' && 'bg-red-100 text-red-800',
                        b.status === 'NO_SHOW' && 'bg-orange-100 text-orange-800',
                      )}
                    >
                      {bookingStatusLabel(t, b.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatMoney(b.totalPriceMinor, b.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
