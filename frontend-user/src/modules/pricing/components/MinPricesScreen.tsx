'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { Check, Loader2, Lock, RefreshCw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { Link } from '@/i18n/navigation';
import { useDateLocale } from '@/hooks/useDateLocale';
import { getApiErrorMessage } from '@/lib/api/error-message';
import { cn } from '@/lib/utils';
import { pricingApi, type PricingPropertyRow, type SettingsItem } from '../api';
import { pricingKeys, usePricingAccess, usePricingMutations, usePricingProperties } from '../hooks';
import { safeDiscountPct } from '../lib/pricing-ui';
import { usePriceFormatter } from './shared';

const GENIUS_OPTIONS = [0, 10, 15, 20] as const;
const IN_FLIGHT = 3;
const GRID = 'grid grid-cols-[2.75rem_minmax(12rem,1.6fr)_9rem_10rem_7.5rem_minmax(9rem,1fr)_minmax(11rem,1.2fr)] items-center gap-3';

type Edit = { min?: string; genius?: number | null };

export function MinPricesScreen() {
  const t = useTranslations('pricing.minPrices');
  const dateLocale = useDateLocale();
  const fmtPrice = usePriceFormatter();
  const { canManage } = usePricingAccess();
  const { data: rows, isLoading, isError, refetch } = usePricingProperties(true);
  const { saveSettings, accessCheck } = usePricingMutations();

  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'attention'>('all');
  const [q, setQ] = useState('');
  const [bulkPct, setBulkPct] = useState('75');
  const [bulkGenius, setBulkGenius] = useState('10');
  const [help, setHelp] = useState<Set<string>>(new Set());
  const [checkingSince, setCheckingSince] = useState<number | null>(null);

  const bookingRows = useMemo(() => (rows ?? []).filter((r) => r.bookingConnected), [rows]);
  const otherRows = useMemo(() => (rows ?? []).filter((r) => !r.bookingConnected), [rows]);

  // Booking prices: at most IN_FLIGHT requests at a time (each one reads Zodomus).
  const [priceLimit, setPriceLimit] = useState(IN_FLIGHT);
  const prices = useQueries({
    queries: bookingRows.map((r, i) => ({
      queryKey: pricingKeys.priceToday(r.id),
      queryFn: () => pricingApi.priceToday(r.id),
      staleTime: 10 * 60_000,
      retry: false,
      enabled: i < priceLimit,
    })),
  });
  const settled = prices.filter((x) => x.isSuccess || x.isError).length;
  useEffect(() => {
    setPriceLimit(settled + IN_FLIGHT);
  }, [settled]);
  const priceOf = (id: string) => {
    const i = bookingRows.findIndex((r) => r.id === id);
    return i >= 0 ? prices[i] : undefined;
  };

  // Poll while an access check runs in the background.
  useEffect(() => {
    if (!checkingSince) return;
    const id = setInterval(() => {
      void refetch();
      if (Date.now() - checkingSince > 90_000) setCheckingSince(null);
    }, 3000);
    return () => clearInterval(id);
  }, [checkingSince, refetch]);
  useEffect(() => {
    if (!checkingSince || !rows) return;
    const done = bookingRows.every((r) => r.promotionsAccessCheckedAt && Date.parse(r.promotionsAccessCheckedAt) >= checkingSince - 1000);
    if (done) {
      setCheckingSince(null);
      const ok = bookingRows.filter((r) => r.promotionsAccess === 'ok').length;
      toast.success(t('checkDone', { ok, denied: bookingRows.length - ok }));
    }
  }, [rows, bookingRows, checkingSince, t]);

  const value = (r: PricingPropertyRow) => {
    const e = edits[r.id];
    const minStr = e?.min !== undefined ? e.min : r.minPrice != null ? String(r.minPrice) : '';
    const genius = e?.genius !== undefined ? e.genius : r.geniusPct;
    const minNum = minStr.trim() === '' ? null : Number(minStr.replace(',', '.'));
    const dirty =
      (e?.min !== undefined && (minNum ?? null) !== (r.minPrice ?? null)) ||
      (e?.genius !== undefined && (e.genius ?? null) !== (r.geniusPct ?? null));
    return { minStr, minNum: minNum != null && Number.isFinite(minNum) ? minNum : null, genius, dirty };
  };

  const safeOf = (r: PricingPropertyRow) => {
    const price = priceOf(r.id)?.data?.price ?? null;
    const v = value(r);
    return price == null ? undefined : safeDiscountPct(price, v.genius, v.minNum);
  };

  const needsAttention = (r: PricingPropertyRow) => {
    const s = safeOf(r);
    return r.promotionsAccess === 'denied' || value(r).minNum == null || (s != null && s <= 0);
  };

  const shown = bookingRows.filter(
    (r) => (filter === 'all' || needsAttention(r)) && (!q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase())),
  );
  const dirtyRows = bookingRows.filter((r) => value(r).dirty);
  const accessOk = bookingRows.filter((r) => r.promotionsAccess === 'ok').length;
  const withMin = bookingRows.filter((r) => value(r).minNum != null).length;
  const limiter = bookingRows
    .filter((r) => r.promotionsAccess !== 'denied')
    .map((r) => ({ r, s: safeOf(r) }))
    .filter((x): x is { r: PricingPropertyRow; s: number } => typeof x.s === 'number')
    .sort((a, b) => a.s - b.s)[0];
  const lastChecked = bookingRows
    .map((r) => r.promotionsAccessCheckedAt)
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);

  const setEdit = (id: string, patch: Edit) => setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const applyBulkMin = () => {
    const pct = Number.parseInt(bulkPct, 10);
    if (!(pct > 0)) return;
    let skipped = 0;
    setEdits((prev) => {
      const next = { ...prev };
      for (const id of selected) {
        const price = priceOf(id)?.data?.price;
        if (price == null) {
          skipped++;
          continue;
        }
        next[id] = { ...next[id], min: String(Math.round((price * pct) / 100 / 10) * 10) };
      }
      return next;
    });
    if (skipped) toast.message(t('bulkNoPrice'));
  };

  const applyBulkGenius = () => {
    const g = Number(bulkGenius);
    setEdits((prev) => {
      const next = { ...prev };
      for (const id of selected) next[id] = { ...next[id], genius: g };
      return next;
    });
  };

  const save = () => {
    const items: SettingsItem[] = dirtyRows.map((r) => {
      const v = value(r);
      return { propertyId: r.id, minPrice: v.minNum, geniusPct: v.genius ?? null };
    });
    saveSettings.mutate(items, {
      onSuccess: () => {
        setEdits({});
        toast.success(t('saved'));
      },
      onError: (e) => toast.error(getApiErrorMessage(e) ?? t('saveError')),
    });
  };

  const runAccessCheck = () =>
    accessCheck.mutate(undefined, {
      onSuccess: () => {
        setCheckingSince(Date.now());
        toast.message(t('checkStarted'));
      },
      onError: (e) => toast.error(getApiErrorMessage(e) ?? t('saveError')),
    });

  if (isError) return <ErrorState message={t('loadError')} onRetry={() => refetch()} />;

  const readOnly = !canManage;
  const checking = !!checkingSince || accessCheck.isPending;

  return (
    <div className="space-y-5 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
        <div className="flex flex-col items-end gap-1">
          <Button variant="outline" className="h-11 gap-2 rounded-xl" disabled={checking || readOnly} onClick={runAccessCheck}>
            <RefreshCw className={cn('h-4 w-4', checking && 'animate-spin')} aria-hidden />
            {checking ? t('checking') : t('checkAccess')}
          </Button>
          <span className="text-xs text-muted-foreground">{t('checkHint')}</span>
        </div>
      </div>

      {readOnly ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3 text-sm">
          <Lock className="h-4 w-4" aria-hidden />
          {t('readOnly')}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi
          label={t('kpiAccess')}
          value={`${accessOk} / ${bookingRows.length}`}
          hint={lastChecked ? t('checkedAt', { when: formatDistanceToNow(parseISO(lastChecked), { locale: dateLocale, addSuffix: true }) }) : t('neverChecked')}
          loading={isLoading}
        />
        <Kpi label={t('kpiMin')} value={`${withMin} / ${bookingRows.length}`} hint={t('kpiMinHint')} loading={isLoading} />
        <Kpi
          label={t('kpiSafe')}
          value={limiter ? (limiter.s > 0 ? t('upTo', { pct: limiter.s }) : t('safeImpossible')) : '—'}
          hint={limiter ? t('kpiSafeHint', { name: limiter.r.name }) : t('kpiSafeEmpty')}
          loading={isLoading}
          tone="success"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4">
          <div className="flex gap-1" role="tablist">
            {(['all', 'attention'] as const).map((k) => {
              const count = k === 'all' ? bookingRows.length : bookingRows.filter(needsAttention).length;
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={filter === k}
                  onClick={() => setFilter(k)}
                  className={cn('inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm', filter === k ? 'bg-muted font-semibold' : 'text-muted-foreground hover:text-foreground')}
                >
                  {t(k === 'all' ? 'filterAll' : 'filterAttention')}
                  <span
                    className={cn(
                      'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold',
                      k === 'attention' && count > 0 ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="relative w-full sm:w-60">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" aria-label={t('search')} placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} className="h-10 pl-9" />
          </div>
        </div>

        {selected.size > 0 && !readOnly ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-primary/5 px-4 py-2.5 text-sm">
            <strong>{t('selected', { count: selected.size })}</strong>
            <label className="inline-flex items-center gap-2">
              {t('bulkMin')}
              <Input value={bulkPct} onChange={(e) => setBulkPct(e.target.value.replace(/\D/g, '').slice(0, 3))} className="h-9 w-16 text-right" aria-label={t('bulkMinAria')} />
              {t('bulkMinSuffix')}
            </label>
            <Button size="sm" onClick={applyBulkMin}>
              {t('apply')}
            </Button>
            <span className="hidden h-6 w-px bg-border sm:block" />
            <label className="inline-flex items-center gap-2">
              Genius
              <Select value={bulkGenius} onChange={(e) => setBulkGenius(e.target.value)} className="h-9 w-24" aria-label={t('bulkGeniusAria')}>
                {GENIUS_OPTIONS.map((g) => (
                  <option key={g} value={g}>
                    {g ? `${g}%` : t('geniusNone')}
                  </option>
                ))}
              </Select>
            </label>
            <Button size="sm" onClick={applyBulkGenius}>
              {t('apply')}
            </Button>
            <button type="button" className="text-primary hover:underline" onClick={() => setSelected(new Set())}>
              {t('clearSelection')}
            </button>
          </div>
        ) : null}

        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[66rem]">
              <div className={cn(GRID, 'bg-muted/50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground')}>
                <span className="flex justify-center">
                  <Checkbox
                    aria-label={t('selectAll')}
                    disabled={readOnly || shown.length === 0}
                    checked={shown.length > 0 && shown.every((r) => selected.has(r.id))}
                    onCheckedChange={(v) => setSelected(v ? new Set(shown.map((r) => r.id)) : new Set())}
                  />
                </span>
                <span>{t('columns.object')}</span>
                <span>{t('columns.today')}</span>
                <span>{t('columns.min')}</span>
                <span>{t('columns.genius')}</span>
                <span>{t('columns.safe')}</span>
                <span>{t('columns.access')}</span>
              </div>
              {shown.map((r) => {
                const v = value(r);
                const pq = priceOf(r.id);
                const price = pq?.data?.price ?? null;
                const currency = pq?.data?.currency;
                const safe = safeOf(r);
                const open = help.has(r.id);
                return (
                  <div key={r.id} className={cn('border-t border-border/60', selected.has(r.id) && 'bg-primary/5')}>
                    <div className={cn(GRID, 'px-4 py-2.5')}>
                      <span className="flex justify-center">
                        <Checkbox
                          aria-label={t('selectOne', { name: r.name })}
                          disabled={readOnly}
                          checked={selected.has(r.id)}
                          onCheckedChange={(c) => {
                            const next = new Set(selected);
                            if (c) next.add(r.id);
                            else next.delete(r.id);
                            setSelected(next);
                          }}
                        />
                      </span>
                      <Link href={`/properties/${r.id}`} className="min-w-0 truncate font-semibold underline decoration-border underline-offset-4 hover:decoration-foreground">
                        {r.name}
                      </Link>
                      <span className="text-sm">
                        {pq?.isLoading || pq?.isFetching ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : price == null ? (
                          <span className="text-muted-foreground">{t('priceUnknown')}</span>
                        ) : (
                          <>
                            <span className="block font-medium">{fmtPrice(price, currency)}</span>
                            <span className="block text-xs text-muted-foreground">
                              {v.genius ? t('geniusPrice', { pct: v.genius, price: fmtPrice(Math.round(price * (100 - v.genius)) / 100) }) : t('noGenius')}
                            </span>
                          </>
                        )}
                      </span>
                      <label className="block">
                        <span
                          className={cn(
                            'flex h-10 items-center gap-1.5 rounded-lg border px-2.5',
                            v.dirty ? 'border-amber-400 bg-amber-50 dark:bg-amber-500/10' : v.minNum == null ? 'border-red-300' : 'border-input bg-input-fill',
                          )}
                        >
                          <input
                            inputMode="decimal"
                            aria-label={t('minAria', { name: r.name })}
                            placeholder={t('noMin')}
                            disabled={readOnly}
                            value={v.minStr}
                            onChange={(e) => setEdit(r.id, { min: e.target.value.replace(/[^\d.,]/g, '').slice(0, 9) })}
                            className="w-full min-w-0 bg-transparent text-sm font-semibold outline-none"
                          />
                          <span className="text-xs text-muted-foreground">{currency ?? ''}</span>
                        </span>
                        {v.dirty ? <span className="text-[11px] text-amber-700 dark:text-amber-400">{t('changed')}</span> : null}
                      </label>
                      <Select
                        aria-label={t('geniusAria', { name: r.name })}
                        disabled={readOnly}
                        value={String(v.genius ?? 0)}
                        onChange={(e) => setEdit(r.id, { genius: Number(e.target.value) })}
                        className="h-10"
                      >
                        {GENIUS_OPTIONS.map((g) => (
                          <option key={g} value={g}>
                            {g ? `${g}%` : t('geniusNone')}
                          </option>
                        ))}
                      </Select>
                      <span className="text-sm">
                        {v.minNum == null ? (
                          <>
                            <span className="block font-bold text-amber-700 dark:text-amber-400">{t('safeNeedMin')}</span>
                            <span className="block text-xs text-muted-foreground">{t('safeNeedMinHint')}</span>
                          </>
                        ) : safe === undefined || safe === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : safe <= 0 ? (
                          <>
                            <span className="block font-bold text-red-700 dark:text-red-400">{t('safeImpossible')}</span>
                            <span className="block text-xs text-muted-foreground">{t('safeImpossibleHint')}</span>
                          </>
                        ) : (
                          <>
                            <span className={cn('block font-bold', safe >= 10 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400')}>
                              {t('upTo', { pct: safe })}
                            </span>
                            <span className="block text-xs text-muted-foreground">{t('safeHint', { min: fmtPrice(v.minNum, currency) })}</span>
                          </>
                        )}
                      </span>
                      <span className="flex flex-col items-start gap-1">
                        {checking ? (
                          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2.5 text-xs font-semibold text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {t('checking')}
                          </span>
                        ) : r.promotionsAccess === 'ok' ? (
                          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-emerald-100 px-2.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                            <Check className="h-3 w-3" />
                            {t('access.ok')}
                          </span>
                        ) : r.promotionsAccess === 'denied' ? (
                          <>
                            <span className="inline-flex h-6 items-center gap-1 rounded-full bg-red-100 px-2.5 text-xs font-semibold text-red-800 dark:bg-red-500/15 dark:text-red-300">
                              <X className="h-3 w-3" />
                              {t('access.denied')}
                            </span>
                            <button
                              type="button"
                              aria-expanded={open}
                              className="text-xs font-semibold text-primary hover:underline"
                              onClick={() => {
                                const next = new Set(help);
                                if (open) next.delete(r.id);
                                else next.add(r.id);
                                setHelp(next);
                              }}
                            >
                              {open ? t('hide') : t('howToFix')}
                            </button>
                          </>
                        ) : (
                          <span className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-xs font-semibold text-muted-foreground">{t('access.unknown')}</span>
                        )}
                      </span>
                    </div>
                    {open && r.promotionsAccess === 'denied' ? (
                      <div className="mx-4 mb-3 ml-[3.75rem] space-y-1.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] text-red-950 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100">
                        <p className="font-semibold">{t('fixTitle', { code: r.promotionsAccessCode ?? '403' })}</p>
                        <p>{t('fixStep1')}</p>
                        <p>{t('fixStep2')}</p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {shown.length === 0 ? <p className="border-t border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">{t('nothing')}</p> : null}
            </div>
          </div>
        )}
      </div>
      {otherRows.length > 0 ? (
        <p className="text-xs text-muted-foreground">{t('notOnBooking', { list: otherRows.map((r) => r.name).join(', ') })}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">{t('geniusNote')}</p>

      {dirtyRows.length > 0 && !readOnly ? (
        <div className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-2xl bg-foreground px-4 py-3 text-background shadow-2xl lg:left-64">
          <span>
            <strong>{t('dirty', { count: dirtyRows.length })}</strong>
            <span className="block text-xs opacity-75">{t('dirtyHint')}</span>
          </span>
          <span className="flex gap-2">
            <Button variant="ghost" className="text-background hover:bg-background/10 hover:text-background" onClick={() => setEdits({})} disabled={saveSettings.isPending}>
              {t('revert')}
            </Button>
            <Button onClick={save} disabled={saveSettings.isPending}>
              {saveSettings.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {t('save')}
            </Button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, hint, loading, tone }: { label: string; value: string; hint: string; loading: boolean; tone?: 'success' }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="mt-1.5 h-7 w-20" />
      ) : (
        <p className={cn('mt-0.5 text-xl font-semibold tabular-nums', tone === 'success' && 'text-emerald-700 dark:text-emerald-400')}>{value}</p>
      )}
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
