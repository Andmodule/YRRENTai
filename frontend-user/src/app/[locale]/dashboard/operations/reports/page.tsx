'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { format, subDays } from 'date-fns';
import { useReportSummary } from '@/modules/operations/hooks/use-operations-data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

function formatMoney(minor: number, currency: string) {
  const major = minor / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency}`;
  }
}

export default function OperationsReportsPage() {
  const t = useTranslations('operations.reports');
  const [to, setTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [from, setFrom] = useState(() => format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const { data, isLoading, error, mutate } = useReportSummary(from, to);

  function setPreset(days: number) {
    setTo(format(new Date(), 'yyyy-MM-dd'));
    setFrom(format(subDays(new Date(), days), 'yyyy-MM-dd'));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rep-from">{t('from')}</Label>
          <Input id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rep-to">{t('to')}</Label>
          <Input id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => setPreset(7)}>
          {t('preset7')}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setPreset(30)}>
          {t('preset30')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => mutate()}>
          {t('refresh')}
        </Button>
      </div>

      {error && <p className="text-sm text-red-400">{t('loadError')}</p>}

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 bg-slate-800" />
          ))}
        </div>
      )}

      {data && !isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('tasks')}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-white">{data.tasks.total}</p>
            <p className="mt-1 text-sm text-slate-400">
              {t('tasksDone')}: {data.tasks.completed}
            </p>
            <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
              {Object.entries(data.tasks.byStatus).map(([k, v]) => (
                <li key={k}>
                  {k}: {v}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('incidents')}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-white">{data.incidents.total}</p>
            <p className="mt-1 text-sm text-amber-400/90">
              {t('incidentsOpen')}: {data.incidents.open}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('bookings')}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-white">{data.bookings.count}</p>
            <p className="mt-1 text-sm text-slate-400">
              {t('revenue')}: {formatMoney(data.bookings.totalRevenueMinor, data.bookings.currency)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('inventory')}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-white">{data.inventory.totalSku}</p>
            <p className="mt-1 text-sm text-amber-400/90">
              {t('lowStock')}: {data.inventory.lowStockCount}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
