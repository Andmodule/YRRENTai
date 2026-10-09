'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BarChart3, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { ResponsiveModal, ResponsiveModalContent } from '@/components/ui/responsive-modal';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from '@/i18n/navigation';
import { getApiErrorMessage } from '@/lib/api/error-message';
import { cn } from '@/lib/utils';
import type { OccupancyRow, OccupancyTier } from '../api';
import { useOccupancy, useOccupancyMutations, usePricingAccess, usePricingMutations } from '../hooks';
import {
  OCCUPANCY_DEFAULTS,
  OCCUPANCY_HORIZON_MAX,
  OCCUPANCY_HORIZON_MIN,
  OCCUPANCY_MAX_TIERS,
  occupancyAction,
  parseOccupancyDraft,
  type OccupancyTierDraft,
} from '../lib/pricing-ui';
import { useStayRangeFormatter } from './shared';

const GRID = 'grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1.4fr)] items-center gap-4';

let draftSeq = 0;
const toDraft = (t: OccupancyTier): OccupancyTierDraft => ({ key: `tier-${++draftSeq}`, below: String(t.belowPct), pct: String(t.discountPct) });

/** «Цены → Заполненность»: the tenant's thresholds and a discount suggestion per property. */
export function OccupancyScreen() {
  const t = useTranslations('pricing.occupancy');
  const access = usePricingAccess();
  const router = useRouter();
  const fmtRange = useStayRangeFormatter();
  const { data, isLoading, isError, refetch } = useOccupancy(access.occupancy);
  const { save } = useOccupancyMutations();
  const { create } = usePricingMutations();

  const [horizon, setHorizon] = useState('');
  const [tiers, setTiers] = useState<OccupancyTierDraft[]>([]);
  const [applying, setApplying] = useState<OccupancyRow | null>(null);

  // The editor follows the server until the person starts typing; a save puts it back in sync.
  const saved = data?.settings;
  const savedKey = saved ? `${saved.horizonDays}|${saved.tiers.map((x) => `${x.belowPct}:${x.discountPct}`).join(',')}` : '';
  useEffect(() => {
    if (!saved) return;
    setHorizon(String(saved.horizonDays));
    setTiers(saved.tiers.map(toDraft));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the saved values change
  }, [savedKey]);

  const parsed = useMemo(() => parseOccupancyDraft(horizon, tiers), [horizon, tiers]);
  const draftKey = parsed.value ? `${parsed.value.horizonDays}|${parsed.value.tiers.map((x) => `${x.belowPct}:${x.discountPct}`).join(',')}` : null;
  const dirty = !!saved && draftKey !== savedKey;

  const setTier = (key: string, patch: Partial<OccupancyTierDraft>) =>
    setTiers((prev) => prev.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const digits = (s: string, max: number) => s.replace(/\D/g, '').slice(0, max);

  const onSave = () => {
    if (!parsed.value) return;
    save.mutate(parsed.value, {
      onSuccess: () => toast.success(t('saved')),
      onError: (e) => toast.error(getApiErrorMessage(e) ?? t('error')),
    });
  };

  const onApply = (row: OccupancyRow) => {
    if (row.suggestedPct == null) return;
    create.mutate(
      {
        name: t('discountName', { pct: row.suggestedPct }),
        discountPct: row.suggestedPct,
        stayFrom: row.from,
        stayTo: row.to,
        propertyIds: [row.propertyId],
        protectMinPrice: true,
      },
      {
        onSuccess: (detail) => {
          setApplying(null);
          toast.success(access.dryRun ? t('appliedDry') : t('applied'));
          // The discount's own panel shows whether Booking really took it.
          router.push(`/dashboard/pricing?promotion=${detail.id}`);
        },
        onError: (e) => toast.error(getApiErrorMessage(e) ?? t('error')),
      },
    );
  };

  if (!access.occupancy) {
    return <EmptyState icon={<BarChart3 className="h-8 w-8" />} title={t('disabledTitle')} description={t('disabledText')} />;
  }

  const actionCell = (row: OccupancyRow) => {
    const action = occupancyAction(row);
    if (action.kind === 'none') return <span className="text-sm text-muted-foreground">{t('noNeed')}</span>;
    if (action.kind === 'covered') {
      return <span className="text-sm text-muted-foreground">{t('covered', { pct: action.currentPct })}</span>;
    }
    if (action.kind === 'not_sent') {
      return (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="text-amber-700 dark:text-amber-400">{t('notSent', { pct: action.pct })}</span>
          <Button size="sm" variant="outline" onClick={() => router.push(`/dashboard/pricing?promotion=${action.promotionId}`)}>
            {t('open')}
          </Button>
        </span>
      );
    }
    if (action.kind === 'blocked') {
      return (
        <span className="text-sm">
          <span className="font-semibold">{t('suggest', { pct: action.pct })}</span>
          <span className="block text-xs text-amber-700 dark:text-amber-400">{t(`blocked.${action.reason}`)}</span>
        </span>
      );
    }
    return (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button size="sm" disabled={dirty || create.isPending} onClick={() => setApplying(row)}>
          {t('apply', { pct: action.pct })}
        </Button>
        {action.currentPct != null ? (
          <span className="text-xs text-muted-foreground">{t('replaces', { pct: action.currentPct })}</span>
        ) : null}
      </span>
    );
  };

  const occupancyCell = (row: OccupancyRow) => (
    <div className="min-w-0">
      <p className="text-sm">
        <strong>{row.occupancyPct}%</strong>{' '}
        <span className="text-muted-foreground">{t('nights', { booked: row.bookedNights, total: row.totalNights })}</span>
      </p>
      <div className="mt-1 h-1.5 w-full max-w-[10rem] overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, row.occupancyPct)}%` }} />
      </div>
    </div>
  );

  const currentCell = (row: OccupancyRow) =>
    row.current ? (
      <span className="text-sm">
        <strong className="text-emerald-700 dark:text-emerald-400">−{row.current.discountPct}%</strong>{' '}
        <span className="text-muted-foreground">
          «{row.current.name}»{row.current.source === 'booking' ? ` · ${t('fromBooking')}` : ''}
        </span>
      </span>
    ) : (
      <span className="text-sm text-muted-foreground">{t('noCurrent')}</span>
    );

  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>

      <section className="space-y-4 rounded-2xl border border-border bg-card px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">{t('rule.title')}</h2>
          {saved?.isDefault ? <span className="text-xs text-muted-foreground">{t('rule.isDefault')}</span> : null}
        </div>

        {isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <>
            <label className="flex flex-wrap items-center gap-2 text-sm">
              {t('rule.horizonBefore')}
              {/* `cn` only joins classes, so the width lives on a wrapper, not on the input */}
              <span className="inline-block w-20">
                <Input
                  inputMode="numeric"
                  aria-label={t('rule.horizonAria')}
                  value={horizon}
                  onChange={(e) => setHorizon(digits(e.target.value, 3))}
                />
              </span>
              {t('rule.horizonAfter')}
            </label>

            <ul className="space-y-2">
              {tiers.map((x, i) => (
                <li key={x.key} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{t('rule.below')}</span>
                  <span className="inline-block w-20">
                    <Input
                      inputMode="numeric"
                      aria-label={t('rule.belowAria', { n: i + 1 })}
                      value={x.below}
                      onChange={(e) => setTier(x.key, { below: digits(e.target.value, 3) })}
                    />
                  </span>
                  <span className="text-muted-foreground">{t('rule.then')}</span>
                  <span className="inline-block w-20">
                    <Input
                      inputMode="numeric"
                      aria-label={t('rule.pctAria', { n: i + 1 })}
                      value={x.pct}
                      onChange={(e) => setTier(x.key, { pct: digits(e.target.value, 2) })}
                    />
                  </span>
                  <span className="text-muted-foreground">%</span>
                  <button
                    type="button"
                    aria-label={t('rule.remove', { n: i + 1 })}
                    disabled={tiers.length <= 1}
                    onClick={() => setTiers((prev) => prev.filter((y) => y.key !== x.key))}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>

            {parsed.problem ? (
              <p className="text-xs text-destructive">
                {t(`rule.problem.${parsed.problem}`, { min: OCCUPANCY_HORIZON_MIN, max: OCCUPANCY_HORIZON_MAX, tiers: OCCUPANCY_MAX_TIERS })}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{t('rule.hint')}</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={tiers.length >= OCCUPANCY_MAX_TIERS}
                onClick={() => setTiers((prev) => [...prev, { key: `tier-${++draftSeq}`, below: '', pct: '' }])}
              >
                <Plus className="h-4 w-4" aria-hidden />
                {t('rule.add')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setHorizon(String(OCCUPANCY_DEFAULTS.horizonDays));
                  setTiers(OCCUPANCY_DEFAULTS.tiers.map(toDraft));
                }}
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
                {t('rule.reset')}
              </Button>
              <Button type="button" size="sm" className="ml-auto" disabled={!dirty || !parsed.value || save.isPending} onClick={onSave}>
                {save.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                {t('rule.save')}
              </Button>
            </div>
          </>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        {dirty ? <p className="border-b border-border/60 bg-muted/50 px-4 py-2 text-xs text-muted-foreground">{t('dirty')}</p> : null}
        {isError ? (
          <ErrorState message={t('loadError')} onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !data || data.properties.length === 0 ? (
          <EmptyState icon={<BarChart3 className="h-8 w-8" />} title={t('empty')} description={t('emptyHint')} />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <div className="min-w-[52rem]">
                <div className={cn(GRID, 'bg-muted/50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground')}>
                  <span>{t('columns.object')}</span>
                  <span>{t('columns.booked')}</span>
                  <span>{t('columns.current')}</span>
                  <span>{t('columns.suggestion')}</span>
                </div>
                {data.properties.map((row) => (
                  <div key={row.propertyId} className={cn(GRID, 'border-t border-border/60 px-4 py-3')}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{row.name}</p>
                      <p className="text-xs text-muted-foreground">{fmtRange(row.from, row.to)}</p>
                    </div>
                    {occupancyCell(row)}
                    {currentCell(row)}
                    {actionCell(row)}
                  </div>
                ))}
              </div>
            </div>
            {/* Mobile cards */}
            <ul className="divide-y divide-border/60 md:hidden">
              {data.properties.map((row) => (
                <li key={row.propertyId} className="space-y-2 px-4 py-3.5">
                  <div>
                    <p className="font-semibold">{row.name}</p>
                    <p className="text-xs text-muted-foreground">{fmtRange(row.from, row.to)}</p>
                  </div>
                  {occupancyCell(row)}
                  <div>{currentCell(row)}</div>
                  <div>{actionCell(row)}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {data && data.notOnBooking > 0 ? <p className="text-xs text-muted-foreground">{t('notOnBooking', { count: data.notOnBooking })}</p> : null}

      <ResponsiveModal open={!!applying} onOpenChange={(o) => (!o ? setApplying(null) : undefined)}>
        <ResponsiveModalContent
          title={applying ? t('confirm.title', { pct: applying.suggestedPct ?? 0 }) : ''}
          description={applying ? `${applying.name} · ${fmtRange(applying.from, applying.to)}` : undefined}
          stackAboveTaskLayer
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button variant="outline" onClick={() => setApplying(null)} disabled={create.isPending}>
                {t('confirm.cancel')}
              </Button>
              <Button onClick={() => applying && onApply(applying)} disabled={create.isPending}>
                {create.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                {t('confirm.launch')}
              </Button>
            </div>
          }
        >
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{t(access.dryRun ? 'confirm.textDry' : 'confirm.text')}</p>
            {applying?.current ? (
              <p className="text-amber-700 dark:text-amber-400">
                {t('confirm.current', { pct: applying.current.discountPct, name: applying.current.name })}
              </p>
            ) : null}
          </div>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </div>
  );
}
