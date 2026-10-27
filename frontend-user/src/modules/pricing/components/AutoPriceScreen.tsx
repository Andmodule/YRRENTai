'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronDown, Loader2, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { getApiErrorMessage } from '@/lib/api/error-message';
import { cn } from '@/lib/utils';
import type { AutoPriceRow, AutoPriceRun, AutoPriceSettingsInput } from '../api';
import { useAutoPrice, useAutoPriceMutations, usePricingAccess } from '../hooks';
import {
  AUTO_MONTH_END_DAYS_MAX,
  AUTO_MONTH_END_DAYS_MIN,
  AUTO_NEXT_DAYS_MAX,
  AUTO_NEXT_DAYS_MIN,
  AUTO_PRICE_DEFAULTS,
  AUTO_TIER_PCT_MAX,
  AUTO_TIERS_MAX,
  autoPriceKey,
  autoPriceState,
  parseAutoPriceDraft,
  signedPct,
  type AutoPriceDraft,
  type AutoTierDraft,
} from '../lib/autoprice-ui';
import { ChoiceChip, usePriceFormatter, useStayRangeFormatter } from './shared';

const KNOWN_ERRORS = new Set(['BUSY', 'NOT_IN_PILOT', 'NOT_ON_BOOKING', 'DATES_OFF', 'JOB_FAILED', 'JOB_STOPPED']);
type KnownError = 'BUSY' | 'NOT_IN_PILOT' | 'NOT_ON_BOOKING' | 'DATES_OFF' | 'JOB_FAILED' | 'JOB_STOPPED';

let draftSeq = 0;
const tierDraft = (share: number | string, pct: number | string): AutoTierDraft => ({
  key: `auto-${++draftSeq}`,
  share: String(share),
  pct: String(pct),
});

function toDraft(s: AutoPriceSettingsInput): AutoPriceDraft {
  return {
    enabled: s.enabled,
    windowKind: s.window.kind,
    days: String(s.window.kind === 'next' ? s.window.days : s.window.daysBefore),
    down: s.down.map((t) => tierDraft(t.unsoldPct, t.pct)),
    up: s.up.map((t) => tierDraft(t.soldPct, t.pct)),
  };
}

const digits = (s: string, max: number) => s.replace(/\D/g, '').slice(0, max);

/**
 * «Цены → Автоцены»: once a day the rule looks at how much of the window is sold and moves the base price
 * of the free nights. In «Только показывать» it only writes the journal.
 */
export function AutoPriceScreen() {
  const t = useTranslations('pricing.autoPrice');
  const locale = useLocale();
  const access = usePricingAccess();
  const fmtRange = useStayRangeFormatter();
  const { data, isLoading, isError, refetch } = useAutoPrice(access.autoPrice);
  const { save } = useAutoPriceMutations();
  const [draft, setDraft] = useState<AutoPriceDraft | null>(null);

  // The editor follows the server until the person starts typing; a save puts it back in sync.
  const saved = data?.settings;
  const savedKey = saved ? autoPriceKey(saved) : '';
  useEffect(() => {
    if (saved) setDraft(toDraft(saved));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the saved values change
  }, [savedKey]);

  const parsed = useMemo(() => (draft ? parseAutoPriceDraft(draft) : null), [draft]);
  const dirty = !!saved && !!parsed && (parsed.value ? autoPriceKey(parsed.value) !== savedKey : true);

  /** Local time of the daily run (the server keeps it in UTC). */
  const runTime = useMemo(() => {
    if (!data) return '';
    const d = new Date(Date.UTC(2026, 0, 15, data.hourUtc, 0));
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d);
  }, [data, locale]);

  if (!access.autoPrice) {
    return <EmptyState icon={<Sparkles className="h-8 w-8" />} title={t('disabledTitle')} description={t('disabledText')} />;
  }

  const patch = (p: Partial<AutoPriceDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const setTier = (side: 'down' | 'up', key: string, p: Partial<AutoTierDraft>) =>
    setDraft((d) => (d ? { ...d, [side]: d[side].map((x) => (x.key === key ? { ...x, ...p } : x)) } : d));

  const onSave = () => {
    if (!parsed?.value) return;
    save.mutate(parsed.value, {
      onSuccess: (o) => toast.success(t(o.dryRun ? 'saved' : 'savedLive')),
      onError: (e) => toast.error(getApiErrorMessage(e) ?? t('error')),
    });
  };

  const tierRows = (side: 'down' | 'up') =>
    draft ? (
      <ul className="space-y-2">
        {draft[side].map((x, i) => (
          <li key={x.key} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t(`rule.${side}.before`)}</span>
            <span className="inline-block w-16">
              <Input
                inputMode="numeric"
                aria-label={t(`rule.${side}.shareAria`, { n: i + 1 })}
                value={x.share}
                onChange={(e) => setTier(side, x.key, { share: digits(e.target.value, 3) })}
              />
            </span>
            <span className="text-muted-foreground">{t(`rule.${side}.middle`)}</span>
            <span className="inline-block w-16">
              <Input
                inputMode="numeric"
                aria-label={t(`rule.${side}.pctAria`, { n: i + 1 })}
                value={x.pct}
                onChange={(e) => setTier(side, x.key, { pct: digits(e.target.value, 2) })}
              />
            </span>
            <span className="text-muted-foreground">%</span>
            <button
              type="button"
              aria-label={t('rule.remove', { n: i + 1 })}
              onClick={() => patch({ [side]: draft[side].filter((y) => y.key !== x.key) })}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </li>
        ))}
        <li>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={draft[side].length >= AUTO_TIERS_MAX}
            onClick={() => patch({ [side]: [...draft[side], tierDraft('', '')] })}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t(`rule.${side}.add`)}
          </Button>
        </li>
      </ul>
    ) : null;

  const working = data?.properties.filter((p) => p.block == null) ?? [];
  const blocked = data?.properties.filter((p) => p.block != null) ?? [];

  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>

      {data ? (
        <p
          className={cn(
            'rounded-xl border px-4 py-3 text-sm',
            data.dryRun
              ? 'border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'
              : 'border-emerald-300/60 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
          )}
        >
          {t(data.dryRun ? 'mode.dry' : 'mode.live', { time: runTime })}
        </p>
      ) : null}

      <section className="space-y-4 rounded-2xl border border-border bg-card px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{t('rule.title')}</h2>
          {draft ? (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft.enabled} onCheckedChange={(v) => patch({ enabled: v })} aria-label={t('rule.enabled')} />
              {t(draft.enabled ? 'rule.on' : 'rule.off')}
            </label>
          ) : null}
        </div>
        {saved?.isDefault ? <p className="text-xs text-muted-foreground">{t('rule.isDefault')}</p> : null}

        {isLoading || !draft ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('rule.window.title')}</p>
              <div className="flex flex-wrap gap-2">
                <ChoiceChip selected={draft.windowKind === 'month_end'} onClick={() => patch({ windowKind: 'month_end' })}>
                  {t('rule.window.monthEnd')}
                </ChoiceChip>
                <ChoiceChip selected={draft.windowKind === 'next'} onClick={() => patch({ windowKind: 'next' })}>
                  {t('rule.window.next')}
                </ChoiceChip>
              </div>
              <label className="flex flex-wrap items-center gap-2 text-sm">
                {t(draft.windowKind === 'next' ? 'rule.window.nextBefore' : 'rule.window.monthEndBefore')}
                <span className="inline-block w-16">
                  <Input
                    inputMode="numeric"
                    aria-label={t('rule.window.daysAria')}
                    value={draft.days}
                    onChange={(e) => patch({ days: digits(e.target.value, 2) })}
                  />
                </span>
                {t(draft.windowKind === 'next' ? 'rule.window.nextAfter' : 'rule.window.monthEndAfter')}
              </label>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('rule.down.title')}</p>
              {tierRows('down')}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('rule.up.title')}</p>
              {tierRows('up')}
            </div>

            {parsed?.problem ? (
              <p className="text-xs text-destructive">
                {t(`rule.problem.${parsed.problem}`, {
                  min: draft.windowKind === 'next' ? AUTO_NEXT_DAYS_MIN : AUTO_MONTH_END_DAYS_MIN,
                  max: draft.windowKind === 'next' ? AUTO_NEXT_DAYS_MAX : AUTO_MONTH_END_DAYS_MAX,
                  pct: AUTO_TIER_PCT_MAX,
                  tiers: AUTO_TIERS_MAX,
                })}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{t('rule.hint')}</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => setDraft(toDraft({ ...AUTO_PRICE_DEFAULTS, enabled: draft.enabled }))}
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
                {t('rule.reset')}
              </Button>
              <Button type="button" size="sm" className="ml-auto" disabled={!dirty || !parsed?.value || save.isPending} onClick={onSave}>
                {save.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                {t('rule.save')}
              </Button>
            </div>
          </>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <h2 className="border-b border-border/60 px-4 py-3 text-sm font-semibold sm:px-5">{t('today.title')}</h2>
        {dirty ? <p className="border-b border-border/60 bg-muted/50 px-4 py-2 text-xs text-muted-foreground">{t('dirty')}</p> : null}
        {isError ? (
          <ErrorState message={t('loadError')} onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-14 w-full" />
          </div>
        ) : working.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">{t('today.nobody')}</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {working.map((row) => (
              <TodayRow key={row.propertyId} row={row} enabled={!!saved?.enabled} fmtRange={fmtRange} />
            ))}
          </ul>
        )}
        {blocked.length > 0 ? (
          <p className="border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
            {[
              blocked.filter((p) => p.block === 'NOT_IN_PILOT').length
                ? t('today.notInPilot', { count: blocked.filter((p) => p.block === 'NOT_IN_PILOT').length })
                : null,
              blocked.filter((p) => p.block !== 'NOT_IN_PILOT').length
                ? t('today.notOnBooking', { count: blocked.filter((p) => p.block !== 'NOT_IN_PILOT').length })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <h2 className="border-b border-border/60 px-4 py-3 text-sm font-semibold sm:px-5">{t('journal.title')}</h2>
        {!data || data.runs.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">{t('journal.empty', { time: runTime })}</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {data.runs.map((run) => (
              <JournalRow key={run.id} run={run} fmtRange={fmtRange} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function NightsList({ nights }: { nights: AutoPriceRow['nights'] }) {
  const t = useTranslations('pricing.autoPrice');
  const fmt = usePriceFormatter();
  const locale = useLocale();
  const day = (ymd: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', weekday: 'short', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`));
  return (
    <ul className="grid gap-1 text-sm sm:grid-cols-2">
      {nights.map((n) => (
        <li key={n.date} className="flex items-baseline justify-between gap-3 rounded-lg bg-muted/40 px-3 py-1.5 tabular-nums">
          <span className="text-muted-foreground">{day(n.date)}</span>
          {n.cleared ? (
            <span>{t('night.cleared')}</span>
          ) : n.status === 'adjusted' || n.status === 'minimum' ? (
            <span>
              <span className="text-muted-foreground line-through">{fmt(n.before)}</span> <strong>{fmt(n.after)}</strong>
              {n.status === 'minimum' ? <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">{t('night.minimum')}</span> : null}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{t(`night.${n.status}`)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function TodayRow({ row, enabled, fmtRange }: { row: AutoPriceRow; enabled: boolean; fmtRange: (a: string | null, b: string | null) => string }) {
  const t = useTranslations('pricing.autoPrice');
  const [open, setOpen] = useState(false);
  const state = autoPriceState(row);
  const summary =
    state.kind === 'silent'
      ? t(enabled ? 'today.silent' : 'today.off')
      : state.kind === 'between'
        ? t('today.between')
        : state.kind === 'change'
          ? t('today.change', { pct: signedPct(state.pct), nights: state.nights })
          : '';
  return (
    <li className="space-y-2 px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="font-semibold">{row.name}</p>
          {row.window ? (
            <p className="text-xs text-muted-foreground">
              {fmtRange(row.window.from, row.window.to)} · {t('today.sold', { pct: row.soldPct, booked: row.bookedNights, total: row.totalNights })}
            </p>
          ) : null}
        </div>
        <p className={cn('text-sm', state.kind === 'change' ? 'font-semibold text-violet-700 dark:text-violet-300' : 'text-muted-foreground')}>
          {summary}
        </p>
      </div>
      {row.window ? (
        <div className="h-1.5 w-full max-w-[14rem] overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, row.soldPct)}%` }} />
        </div>
      ) : null}
      {row.cleared.length > 0 ? <p className="text-xs text-muted-foreground">{t('today.willClear', { count: row.cleared.length })}</p> : null}
      {row.nights.length > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {t(open ? 'today.hideNights' : 'today.showNights')}
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
          </button>
          {open ? <NightsList nights={row.nights} /> : null}
        </>
      ) : null}
    </li>
  );
}

function JournalRow({ run, fmtRange }: { run: AutoPriceRun; fmtRange: (a: string | null, b: string | null) => string }) {
  const t = useTranslations('pricing.autoPrice');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const when = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(run.runAt));
  const r = run.result;
  const parts = [
    run.window ? t('journal.sold', { pct: run.totalNights ? Math.floor((run.bookedNights * 100) / run.totalNights) : 0, range: fmtRange(run.window.from, run.window.to) }) : null,
    r.changed ? t(run.dryRun ? 'journal.wouldChange' : 'journal.changed', { count: r.changed, pct: signedPct(run.pct) }) : null,
    r.cleared ? t(run.dryRun ? 'journal.wouldClear' : 'journal.cleared', { count: r.cleared }) : null,
    !r.changed && !r.cleared ? t('journal.nothing') : null,
    r.sent != null && r.sent > 0 ? t('journal.sent', { count: r.sent }) : null,
    r.failed ? t('journal.failed', { count: r.failed }) : null,
    r.mismatched ? t('journal.mismatched', { count: r.mismatched }) : null,
  ].filter(Boolean);
  return (
    <li className="space-y-2 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm">
          <span className="font-semibold">{run.propertyName}</span> <span className="text-muted-foreground">· {when}</span>
          {run.dryRun ? (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              {t('journal.dry')}
            </span>
          ) : null}
        </p>
        {run.nights.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {t(open ? 'today.hideNights' : 'today.showNights')}
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
          </button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{parts.join(' · ')}</p>
      {r.error ? (
        <p className="text-xs text-destructive">
          {KNOWN_ERRORS.has(r.error) ? t(`journal.error.${r.error as KnownError}`) : r.error}
        </p>
      ) : null}
      {open ? <NightsList nights={run.nights} /> : null}
    </li>
  );
}
