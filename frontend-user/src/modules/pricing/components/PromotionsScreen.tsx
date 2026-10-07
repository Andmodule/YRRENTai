'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Percent, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { getApiErrorMessage } from '@/lib/api/error-message';
import { cn } from '@/lib/utils';
import type { PromotionDetail, PromotionSummary } from '../api';
import { usePricingMutations, usePromotions } from '../hooks';
import { isRuleStep, sumRevenue } from '../lib/pricing-ui';
import { PromotionDetailSheet } from './PromotionDetailSheet';
import { PromotionFormSheet, type PromotionFormInitial } from './PromotionFormSheet';
import { CampaignStatusBadge, ConfirmDialog, usePriceFormatter, useStayRangeFormatter } from './shared';

type Tab = 'all' | 'active' | 'past';
type FormState = { promotion?: PromotionDetail; initial?: PromotionFormInitial } | null;

const GRID = 'grid grid-cols-[minmax(13rem,2fr)_5rem_minmax(9rem,1.2fr)_8rem_minmax(10rem,1.3fr)_8rem_8rem] items-center gap-4';

export function PromotionsScreen() {
  const t = useTranslations('pricing.promotions');
  const tw = useTranslations('pricing.form.weekdayShort');
  const fmtRange = useStayRangeFormatter();
  const fmtPrice = usePriceFormatter();
  const searchParams = useSearchParams();
  const { data: promos, isLoading, isError, refetch } = usePromotions(true);
  const { setActive, accessCheck } = usePricingMutations();

  const [tab, setTab] = useState<Tab>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const [confirmOff, setConfirmOff] = useState<PromotionSummary | null>(null);

  // Deep links: ?promotion=<id> (calendar, property page) and ?new=<propertyId> («Скидка для объекта»).
  useEffect(() => {
    const id = searchParams.get('promotion');
    if (id) setDetailId(id);
    const forProperty = searchParams.get('new');
    if (forProperty) setForm({ initial: { propertyIds: [forProperty] } });
  }, [searchParams]);

  // Steps of auto rules live on their own tab.
  const list = useMemo(() => (promos ?? []).filter((p) => !isRuleStep(p)), [promos]);
  const active = list.filter((p) => p.derivedStatus === 'active');
  const visible = list.filter((p) =>
    tab === 'all' ? true : tab === 'active' ? p.derivedStatus === 'active' : p.derivedStatus !== 'active',
  );
  const kpi = useMemo(() => {
    const objects = active.reduce((a, p) => a + p.counts.on + p.counts.pending + p.counts.dry_run, 0);
    let bookings = 0;
    const revenue: Record<string, number> = {};
    for (const p of list) {
      if (!p.stats) continue;
      bookings += p.stats.bookings;
      for (const [cur, v] of Object.entries(p.stats.revenueByCurrency)) revenue[cur] = (revenue[cur] ?? 0) + v;
    }
    return { objects, bookings, revenue: sumRevenue(revenue) };
  }, [active, list]);

  const repeat = (p: PromotionSummary | PromotionDetail) => {
    setDetailId(null);
    setForm({
      initial: {
        discountPct: p.discountPct,
        name: p.name,
        weekdays: p.activeWeekdays,
        propertyIds: 'targets' in p ? p.targets.map((x) => x.propertyId) : undefined,
      },
    });
  };

  const typeLabel = (type: string) =>
    type === 'last_minute' ? t('typeLastMinute') : type === 'early_booker' ? t('typeEarlyBooker') : t('typeBasic');

  const objectsCell = (p: PromotionSummary) => {
    const live = p.counts.on + p.counts.pending + p.counts.dry_run;
    return (
      <div className="text-sm">
        <div>{live === p.counts.total ? t('objectsCount', { count: p.counts.total }) : t('objectsPartial', { on: live, total: p.counts.total })}</div>
        {p.counts.error > 0 ? <div className="text-xs text-amber-700 dark:text-amber-400">{t('withErrors', { count: p.counts.error })}</div> : null}
        {p.counts.pending > 0 ? <div className="text-xs text-sky-700 dark:text-sky-400">{t('inProgress', { count: p.counts.pending })}</div> : null}
      </div>
    );
  };

  const resultCell = (p: PromotionSummary) =>
    p.stats ? (
      <span className="text-sm font-medium">
        {t('bookings', { count: p.stats.bookings })}
        {sumRevenue(p.stats.revenueByCurrency).map((r) => ` · ${fmtPrice(r.amount, r.currency)}`)}
      </span>
    ) : (
      <span className="text-sm text-muted-foreground">{t('noData')}</span>
    );

  const actionButton = (p: PromotionSummary) => {
    if (p.source === 'booking') {
      return (
        <Button size="sm" variant="outline" onClick={() => setDetailId(p.id)}>
          {t('actions.details')}
        </Button>
      );
    }
    if (p.derivedStatus === 'active') {
      return (
        <Button size="sm" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300" onClick={() => setConfirmOff(p)}>
          {t('actions.deactivate')}
        </Button>
      );
    }
    return (
      <Button size="sm" variant="outline" onClick={() => repeat(p)}>
        {t('actions.repeat')}
      </Button>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
        <Button onClick={() => setForm({})} className="h-11 gap-2 rounded-xl px-4">
          <Plus className="h-4 w-4" aria-hidden />
          {t('new')}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label={t('kpiActive')} value={t('kpiActiveValue', { count: active.length })} hint={t('kpiActiveSub', { count: kpi.objects })} loading={isLoading} />
        <KpiCard label={t('kpiBookings')} value={t('bookings', { count: kpi.bookings })} hint={t('kpiSource')} loading={isLoading} />
        <KpiCard
          label={t('kpiRevenue')}
          value={kpi.revenue.map((r) => fmtPrice(r.amount, r.currency)).join(' · ') || '—'}
          hint={t('kpiSource')}
          loading={isLoading}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4">
          <div className="flex min-w-0 max-w-full gap-1 overflow-x-auto" role="tablist">
            {(['all', 'active', 'past'] as const).map((k) => {
              const count = k === 'all' ? list.length : k === 'active' ? active.length : list.length - active.length;
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={cn(
                    'inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm sm:gap-2 sm:px-3',
                    tab === k ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(`tabs.${k}`)}
                  <span className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold', tab === k ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground')}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="hidden sm:inline">{t('syncHint')}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={accessCheck.isPending}
              onClick={() =>
                accessCheck.mutate(undefined, {
                  onSuccess: () => {
                    toast.success(t('refreshed'));
                    setTimeout(() => void refetch(), 8000);
                  },
                  onError: (e) => toast.error(getApiErrorMessage(e) ?? t('loadError')),
                })
              }
            >
              <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', accessCheck.isPending && 'animate-spin')} aria-hidden />
              {t('refresh')}
            </Button>
          </div>
        </div>

        {isError ? (
          <ErrorState message={t('loadError')} onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Percent className="h-8 w-8" />}
            title={t('empty')}
            description={t('emptyHint')}
            action={
              <Button onClick={() => setForm({})} className="gap-2">
                <Plus className="h-4 w-4" />
                {t('new')}
              </Button>
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <div className="min-w-[60rem]">
                <div className={cn(GRID, 'bg-muted/50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground')}>
                  <span>{t('columns.name')}</span>
                  <span>{t('columns.discount')}</span>
                  <span>{t('columns.dates')}</span>
                  <span>{t('columns.objects')}</span>
                  <span>{t('columns.result')}</span>
                  <span>{t('columns.status')}</span>
                  <span />
                </div>
                {visible.map((p) => (
                  <div key={p.id} className={cn(GRID, 'border-t border-border/60 px-4 py-3')}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => setDetailId(p.id)} className="truncate text-left text-sm font-semibold underline decoration-border underline-offset-4 hover:decoration-foreground">
                          {p.name}
                        </button>
                        {p.source === 'booking' ? (
                          <span className="rounded-full border border-indigo-200 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:border-indigo-500/30 dark:text-indigo-300">
                            {t('fromBooking')}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {typeLabel(p.promotionType)} · {p.activeWeekdays?.length ? p.activeWeekdays.map((d) => tw(d)).join(', ') : t('allDays')}
                      </p>
                    </div>
                    <span className="text-base font-bold text-emerald-700 dark:text-emerald-400">−{p.discountPct}%</span>
                    <span className="text-sm">{fmtRange(p.stayFrom, p.stayTo)}</span>
                    {objectsCell(p)}
                    {resultCell(p)}
                    <span>
                      <CampaignStatusBadge status={p.derivedStatus} />
                    </span>
                    <span className="text-right">{actionButton(p)}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Mobile cards */}
            <ul className="divide-y divide-border/60 md:hidden">
              {visible.map((p) => (
                <li key={p.id} className="space-y-2 px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" onClick={() => setDetailId(p.id)} className="min-w-0 text-left">
                      <span className="block truncate font-semibold">{p.name}</span>
                      <span className="block text-xs text-muted-foreground">{fmtRange(p.stayFrom, p.stayTo)}</span>
                    </button>
                    <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400">−{p.discountPct}%</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CampaignStatusBadge status={p.derivedStatus} />
                    {p.source === 'booking' ? <span className="text-xs text-indigo-700 dark:text-indigo-300">{t('fromBooking')}</span> : null}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    {objectsCell(p)}
                    {actionButton(p)}
                  </div>
                  {resultCell(p)}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('footer')}</p>

      <PromotionDetailSheet
        promotionId={detailId}
        onOpenChange={(o) => !o && setDetailId(null)}
        onEdit={(p) => {
          setDetailId(null);
          setForm({ promotion: p });
        }}
        onRepeat={repeat}
      />
      <PromotionFormSheet
        open={!!form}
        onOpenChange={(o) => !o && setForm(null)}
        promotion={form?.promotion ?? null}
        initial={form?.initial ?? null}
        onDone={(id) => setDetailId(id)}
      />
      <ConfirmDialog
        open={!!confirmOff}
        onOpenChange={(o) => !o && setConfirmOff(null)}
        title={t('confirmOffTitle')}
        text={t('confirmOffText', { name: confirmOff?.name ?? '' })}
        confirmLabel={t('actions.deactivate')}
        pending={setActive.isPending}
        onConfirm={() => {
          if (!confirmOff) return;
          setActive.mutate(
            { id: confirmOff.id, on: false },
            {
              onSuccess: () => {
                toast.success(t('offDone'));
                setConfirmOff(null);
              },
              onError: (e) => toast.error(getApiErrorMessage(e) ?? t('loadError')),
            },
          );
        }}
      />
    </div>
  );
}

function KpiCard({ label, value, hint, loading }: { label: string; value: string; hint: string; loading: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      {loading ? <Skeleton className="mt-1.5 h-7 w-24" /> : <p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p>}
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
