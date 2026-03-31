'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { format } from 'date-fns';
import { Package, Languages, BarChart3, ListTodo, AlertTriangle } from 'lucide-react';
import { useReportSummary } from '@/modules/operations/hooks/use-operations-data';
import { Skeleton } from '@/components/ui/skeleton';

export default function OperationsOverviewPage() {
  const t = useTranslations('operations.overview');
  const to = format(new Date(), 'yyyy-MM-dd');
  const from = format(new Date(Date.now() - 30 * 86400000), 'yyyy-MM-dd');
  const { data, isLoading, error } = useReportSummary(from, to);

  const cards = [
    {
      href: '/dashboard/operations/inventory',
      icon: Package,
      title: t('cardInventoryTitle'),
      desc: t('cardInventoryDesc'),
    },
    {
      href: '/dashboard/operations/listings',
      icon: Languages,
      title: t('cardListingsTitle'),
      desc: t('cardListingsDesc'),
    },
    {
      href: '/dashboard/operations/reports',
      icon: BarChart3,
      title: t('cardReportsTitle'),
      desc: t('cardReportsDesc'),
    },
    {
      href: '/dashboard/tasks',
      icon: ListTodo,
      title: t('cardTasksTitle'),
      desc: t('cardTasksDesc'),
    },
  ];

  return (
    <div className="space-y-8">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ href, icon: Icon, title, desc }) => (
          <Link
            key={href}
            href={href}
            className="group rounded-xl border border-slate-800 bg-slate-900/50 p-4 transition-colors hover:border-slate-600 hover:bg-slate-900"
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-500/20">
              <Icon className="h-5 w-5" />
            </div>
            <h2 className="font-medium text-white group-hover:text-primary">{title}</h2>
            <p className="mt-1 text-xs text-slate-400">{desc}</p>
          </Link>
        ))}
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">{t('snapshotTitle')}</h2>
        {error && <p className="text-sm text-red-400">{t('loadError')}</p>}
        {isLoading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 bg-slate-800" />
            ))}
          </div>
        )}
        {data && !isLoading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
              <p className="text-xs text-slate-500">{t('tasksTotal')}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{data.tasks.total}</p>
              <p className="mt-1 text-xs text-slate-400">
                {t('tasksDone')}: {data.tasks.completed}
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
              <p className="text-xs text-slate-500">{t('incidents')}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{data.incidents.total}</p>
              <p className="mt-1 text-xs text-amber-400/90">
                {t('incidentsOpen')}: {data.incidents.open}
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
              <p className="text-xs text-slate-500">{t('bookings')}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{data.bookings.count}</p>
            </div>
            <div
              className={`rounded-lg border p-4 ${
                data.inventory.lowStockCount > 0
                  ? 'border-amber-500/40 bg-amber-500/5'
                  : 'border-slate-800 bg-slate-950/50'
              }`}
            >
              <div className="flex items-center gap-2">
                {data.inventory.lowStockCount > 0 && <AlertTriangle className="h-4 w-4 text-amber-500" />}
                <p className="text-xs text-slate-500">{t('lowStock')}</p>
              </div>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{data.inventory.lowStockCount}</p>
              <p className="mt-1 text-xs text-slate-400">
                {t('skuTotal')}: {data.inventory.totalSku}
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
