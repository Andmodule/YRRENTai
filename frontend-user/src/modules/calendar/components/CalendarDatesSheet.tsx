'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, CalendarDays, Check, Clock, Loader2, Lock, LockOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ResponsiveModal, ResponsiveModalContent } from '@/components/ui/responsive-modal';
import { getApiErrorMessage } from '@/lib/api/error-message';
import { cn } from '@/lib/utils';
import { ChoiceChip, SectionTitle, usePriceFormatter, useStayRangeFormatter } from '@/modules/pricing/components/shared';
import type { BookingWeekday } from '@/modules/pricing/api';
import { WEEKDAYS, addDaysYmd, localYmd, nightsCount } from '@/modules/pricing/lib/pricing-ui';
import type { Property } from '../types';
import {
  useAutoOpen,
  useCalendarDatesAccess,
  useCalendarDatesJob,
  useCalendarDatesMutations,
  type CalendarDatesJob,
  type CalendarDatesPreview,
} from '../calendar-dates-api';
import {
  HORIZON_PRESETS,
  RANGE_PRESETS,
  buildDatesRequest,
  estimateParts,
  lastAllowedNight,
  parsePrice,
  presetLastNight,
  requestKey,
  skippedList,
  type DatesAction,
  type PriceMode,
  type RangePreset,
} from '../lib/calendar-dates';

export interface CalendarDatesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  properties: Property[];
  initialPropertyId?: string | null;
  /** Inclusive first / last night (calendar cell or selection). */
  initialFrom?: string | null;
  initialTo?: string | null;
}

const WARN_BOX =
  'rounded-xl border border-amber-300/70 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100';
const BAD_BOX =
  'rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-950 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100';

/**
 * «Открыть / закрыть даты на Booking» — what Booking's own availability planner did before the channel
 * manager connection locked the extranet. One property, one range; a preview first, then the run with a
 * report read back from Booking. Auto-extension («держать открытыми N дней») sits below.
 */
export function CalendarDatesSheet({
  open,
  onOpenChange,
  properties,
  initialPropertyId = null,
  initialFrom = null,
  initialTo = null,
}: CalendarDatesSheetProps) {
  const t = useTranslations('calendar.datesForm');
  const tw = useTranslations('pricing.form.weekdayShort');
  const fmtRange = useStayRangeFormatter();
  const fmtPrice = usePriceFormatter();
  const qc = useQueryClient();
  const access = useCalendarDatesAccess();
  const { preview, apply } = useCalendarDatesMutations();
  const today = localYmd();

  const linked = useMemo(
    () => properties.filter((p) => p.zodomusLinked || Boolean(p.zodomusPropertyId?.trim())),
    [properties],
  );

  const [step, setStep] = useState<'form' | 'run'>('form');
  const [propertyId, setPropertyId] = useState('');
  const [action, setAction] = useState<DatesAction>('open');
  const [preset, setPreset] = useState<RangePreset>(90);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [days, setDays] = useState<Set<BookingWeekday>>(new Set(WEEKDAYS));
  const [priceMode, setPriceMode] = useState<PriceMode>('keep');
  const [price, setPrice] = useState('');
  const [weekendPrice, setWeekendPrice] = useState('');
  const [repriceOpen, setRepriceOpen] = useState(false);
  const [shown, setShown] = useState<{ key: string; data: CalendarDatesPreview } | null>(null);

  // Reset every time the sheet opens.
  useEffect(() => {
    if (!open) return;
    // Opened for a property that is not on Booking: make the person pick one, never slip in another.
    const preferred = initialPropertyId
      ? linked.some((p) => p.uuid === initialPropertyId)
        ? initialPropertyId
        : ''
      : linked.length === 1
        ? linked[0]!.uuid
        : '';
    setPropertyId(preferred);
    setStep('form');
    setAction('open');
    const start = initialFrom && initialFrom > today ? initialFrom : today;
    setFrom(start);
    if (initialTo && initialTo >= start) {
      setPreset('custom');
      setTo(initialTo);
    } else {
      setPreset(90);
      setTo(presetLastNight(start, 90));
    }
    setDays(new Set(WEEKDAYS));
    setPriceMode('keep');
    setPrice('');
    setWeekendPrice('');
    setRepriceOpen(false);
    setShown(null);
    preview.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open
  }, [open]);

  const property = linked.find((p) => p.uuid === propertyId);
  const currency = shown?.data.currency ?? property?.otaCurrency ?? property?.currency ?? null;
  const lastNight = lastAllowedNight(today, access.horizonDays);
  const request = buildDatesRequest(
    { propertyId, action, from, to, weekdays: days, priceMode, price, weekendPrice, repriceOpen },
    today,
    lastNight,
  );
  const key = request.ok ? requestKey(request.body) : null;
  const fresh = shown && key && shown.key === key ? shown.data : null;

  const job = useCalendarDatesJob(propertyId, open && access.enabled);
  const running = job.data?.state === 'running';

  // When a run ends, the calendar re-reads the dates from Booking.
  const lastState = useRef<string | null>(null);
  useEffect(() => {
    const s = job.data?.state ?? null;
    if (lastState.current === 'running' && s && s !== 'running') {
      void qc.invalidateQueries({ queryKey: ['calendar'] });
    }
    lastState.current = s;
  }, [job.data?.state, qc]);

  const pickPreset = (p: RangePreset) => {
    setPreset(p);
    if (p !== 'custom') setTo(presetLastNight(from, p));
  };

  const check = async () => {
    if (!request.ok) return;
    try {
      const data = await preview.mutateAsync(request.body);
      setShown({ key: requestKey(request.body), data });
    } catch (e) {
      setShown(null);
      toast.error(getApiErrorMessage(e) ?? t('error'));
    }
  };

  const submit = async () => {
    if (!request.ok || !fresh) return;
    try {
      await apply.mutateAsync(request.body);
      setStep('run');
    } catch (e) {
      toast.error(getApiErrorMessage(e) ?? t('error'));
    }
  };

  const changesTotal = fresh ? fresh.changes.open + fresh.changes.close + fresh.changes.price : 0;
  // «Закрыть» on dates that are closed already sends nothing, but remembers them for auto-extension.
  const remembersOnly = !!fresh && action === 'close' && fresh.alreadyClosed > 0;
  const canSubmit = !!fresh && (changesTotal > 0 || remembersOnly) && !fresh.tooMany && !apply.isPending && !running;

  const footer =
    step === 'form' ? (
      <div className="flex w-full flex-col gap-2">
        {!request.ok ? <p className="text-xs text-destructive">{t(`errors.${request.error}`)}</p> : null}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={apply.isPending}>
            {t('cancel')}
          </Button>
          {fresh ? (
            <Button
              className="flex-1"
              variant={action === 'close' ? 'destructive' : 'default'}
              onClick={submit}
              disabled={!canSubmit}
            >
              {apply.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {t(action === 'open' ? 'submitOpen' : 'submitClose')}
            </Button>
          ) : (
            <Button className="flex-1" onClick={check} disabled={!request.ok || preview.isPending || running}>
              {preview.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {t(preview.isPending ? 'checking' : 'check')}
            </Button>
          )}
        </div>
      </div>
    ) : (
      <div className="flex w-full justify-end gap-2">
        {!running ? (
          <Button
            variant="outline"
            onClick={() => {
              setShown(null);
              setStep('form');
            }}
          >
            {t('again')}
          </Button>
        ) : null}
        <Button onClick={() => onOpenChange(false)}>{t(running ? 'collapse' : 'done')}</Button>
      </div>
    );

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} desktopPresentation="side">
      <ResponsiveModalContent title={t('title')} description={t('description')} footer={footer} className="sm:max-w-xl">
        {step === 'run' ? (
          <RunReport job={job.data ?? null} loading={job.isLoading} />
        ) : (
          <div className="space-y-7 pb-2">
            {running ? (
              <div className={cn(WARN_BOX, 'flex items-center gap-3')}>
                <Clock className="h-4 w-4 shrink-0" aria-hidden />
                <span className="flex-1">{t('runningBanner')}</span>
                <Button size="sm" variant="outline" onClick={() => setStep('run')}>
                  {t('showRun')}
                </Button>
              </div>
            ) : null}

            <section className="space-y-2.5">
              <SectionTitle>{t('property')}</SectionTitle>
              {linked.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noBookingProperties')}</p>
              ) : (
                <Select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                  <option value="">{t('propertyPlaceholder')}</option>
                  {linked.map((p) => (
                    <option key={p.uuid} value={p.uuid}>
                      {p.title}
                    </option>
                  ))}
                </Select>
              )}
            </section>

            <section className="space-y-2.5">
              <SectionTitle>{t('actionTitle')}</SectionTitle>
              <div className="grid grid-cols-2 gap-2">
                {(['open', 'close'] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={action === a}
                    onClick={() => setAction(a)}
                    className={cn(
                      'flex min-h-16 flex-col items-start gap-0.5 rounded-xl border px-3.5 py-3 text-left text-sm',
                      action === a
                        ? a === 'open'
                          ? 'border-emerald-500 bg-emerald-50 ring-1 ring-inset ring-emerald-500 dark:bg-emerald-500/10'
                          : 'border-red-500 bg-red-50 ring-1 ring-inset ring-red-500 dark:bg-red-500/10'
                        : 'border-border bg-card hover:border-primary/40',
                    )}
                  >
                    <span className="flex items-center gap-1.5 font-semibold">
                      {a === 'open' ? <LockOpen className="h-4 w-4" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
                      {t(a === 'open' ? 'actionOpen' : 'actionClose')}
                    </span>
                    <span className="text-xs text-muted-foreground">{t(a === 'open' ? 'actionOpenHint' : 'actionCloseHint')}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-2.5">
              <SectionTitle>{t('datesTitle')}</SectionTitle>
              <div className="flex flex-wrap gap-2">
                {[...RANGE_PRESETS, 'custom' as const].map((p) => (
                  <ChoiceChip key={String(p)} selected={preset === p} onClick={() => pickPreset(p)}>
                    {t(`preset.${p}`)}
                  </ChoiceChip>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                  {t('from')}
                  <Input
                    type="date"
                    min={today}
                    max={lastNight}
                    value={from}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      setFrom(v);
                      if (preset !== 'custom') setTo(presetLastNight(v, preset));
                      else if (to < v) setTo(v);
                    }}
                  />
                </label>
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                  {t('to')}
                  <Input
                    type="date"
                    min={from}
                    max={addDaysYmd(from, 365) < lastNight ? addDaysYmd(from, 365) : lastNight}
                    value={to}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      setTo(e.target.value);
                      setPreset('custom');
                    }}
                  />
                </label>
              </div>
              {from <= to ? (
                <div className="flex items-center gap-2.5 rounded-xl bg-muted px-3 py-2.5 text-sm">
                  <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span>
                    <strong>{fmtRange(from, to)}</strong>
                    <span className="text-muted-foreground"> · {t('nights', { count: nightsCount(from, to) })}</span>
                  </span>
                </div>
              ) : null}
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">{t('weekdays')}</p>
                <div className="grid max-w-md grid-cols-7 gap-1.5">
                  {WEEKDAYS.map((d) => (
                    <ChoiceChip
                      key={d}
                      compact
                      selected={days.has(d)}
                      onClick={() => {
                        const next = new Set(days);
                        if (next.has(d)) next.delete(d);
                        else next.add(d);
                        setDays(next);
                      }}
                    >
                      {tw(d)}
                    </ChoiceChip>
                  ))}
                </div>
              </div>
            </section>

            {action === 'open' ? (
              <section className="space-y-2.5">
                <SectionTitle>{t('priceTitle')}</SectionTitle>
                <div className="flex flex-wrap gap-2">
                  {(['keep', 'one', 'split'] as const).map((m) => (
                    <ChoiceChip key={m} selected={priceMode === m} onClick={() => setPriceMode(m)}>
                      {t(`priceMode.${m}`)}
                    </ChoiceChip>
                  ))}
                </div>
                {priceMode === 'keep' ? (
                  <p className="text-xs text-muted-foreground">{t('priceKeepHint')}</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                        {t(priceMode === 'split' ? 'weekdayPrice' : 'pricePerNight', { currency: currency ?? '' })}
                        <Input inputMode="decimal" value={price} placeholder="0" onChange={(e) => setPrice(e.target.value)} />
                      </label>
                      {priceMode === 'split' ? (
                        <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                          {t('weekendPrice', { currency: currency ?? '' })}
                          <Input
                            inputMode="decimal"
                            value={weekendPrice}
                            placeholder="0"
                            onChange={(e) => setWeekendPrice(e.target.value)}
                          />
                        </label>
                      ) : null}
                    </div>
                    {priceMode === 'split' ? <p className="text-xs text-muted-foreground">{t('weekendHint')}</p> : null}
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border px-3.5 py-3">
                      <Checkbox checked={repriceOpen} onCheckedChange={(v) => setRepriceOpen(v === true)} className="mt-0.5" />
                      <span>
                        <span className="block text-sm font-medium">{t('repriceOpen')}</span>
                        <span className="block text-xs text-muted-foreground">{t('repriceOpenHint')}</span>
                      </span>
                    </label>
                  </>
                )}
                {fresh?.minPrice != null ? (
                  <p className="text-xs text-muted-foreground">{t('minPrice', { price: fmtPrice(fresh.minPrice, currency) })}</p>
                ) : null}
              </section>
            ) : null}

            {shown ? (
              <PreviewCard data={shown.data} stale={!fresh} currency={currency} />
            ) : (
              <p className="text-xs text-muted-foreground">{t('checkHint')}</p>
            )}

            {access.auto && propertyId ? <AutoOpenCard propertyId={propertyId} currency={currency} /> : null}
          </div>
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

function PreviewCard({ data, stale, currency }: { data: CalendarDatesPreview; stale: boolean; currency: string | null }) {
  const t = useTranslations('calendar.datesForm');
  const fmtRange = useStayRangeFormatter();
  const fmtPrice = usePriceFormatter();
  const total = data.changes.open + data.changes.close + data.changes.price;
  const time = estimateParts(data.estimateSeconds);
  const skipped = skippedList(data.skipped);
  return (
    <section className={cn('space-y-3 rounded-xl border border-border px-3.5 py-3', stale && 'opacity-50')}>
      <SectionTitle>{t('previewTitle')}</SectionTitle>
      <p className="text-sm">
        <span className="text-muted-foreground">{t('previewProperty')} </span>
        <strong>{data.propertyName}</strong>
        <span className="text-muted-foreground"> · {fmtRange(data.dateFrom, addDaysYmd(data.dateToExclusive, -1))}</span>
      </p>
      {stale ? <p className="text-xs text-amber-700 dark:text-amber-400">{t('stale')}</p> : null}
      {total === 0 && !(data.action === 'close' && data.alreadyClosed > 0) ? (
        <p className="text-sm">{t('nothing')}</p>
      ) : total === 0 ? null : (
        <ul className="space-y-1 text-sm">
          {data.changes.open > 0 ? <li className="font-semibold text-emerald-700 dark:text-emerald-400">{t('changeOpen', { count: data.changes.open })}</li> : null}
          {data.changes.close > 0 ? <li className="font-semibold text-red-700 dark:text-red-400">{t('changeClose', { count: data.changes.close })}</li> : null}
          {data.changes.price > 0 ? <li className="font-semibold text-amber-700 dark:text-amber-400">{t('changePrice', { count: data.changes.price })}</li> : null}
        </ul>
      )}
      {data.action === 'close' && data.alreadyClosed > 0 ? (
        <p className="text-sm">{t('alreadyClosed', { count: data.alreadyClosed })}</p>
      ) : null}
      {skipped.length > 0 ? (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>{t('skippedTitle')}</p>
          {skipped.map(([reason, count]) => (
            <p key={reason}>· {t(`skip.${reason}`, { count })}</p>
          ))}
        </div>
      ) : null}
      {data.ranges.length > 0 ? (
        <ul className="overflow-hidden rounded-lg border border-border/70 text-[13px]">
          {data.ranges.map((r) => (
            <li key={r.dateFrom} className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-1.5 last:border-b-0">
              <span>{fmtRange(r.dateFrom, addDaysYmd(r.dateToExclusive, -1))}</span>
              <span className={cn('whitespace-nowrap font-medium', r.closed ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400')}>
                {r.closed ? t('rangeClosed') : t('rangeOpen', { price: fmtPrice(r.price, currency) })}
              </span>
            </li>
          ))}
          {data.requests > data.ranges.length ? (
            <li className="px-3 py-1.5 text-xs text-muted-foreground">{t('more', { count: data.requests - data.ranges.length })}</li>
          ) : null}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {data.rate.name ? t('rate', { name: data.rate.name }) : t('rate', { name: data.rate.id })}
        {total > 0 ? ` · ${t('requests', { count: data.requests, time: t(time.unit === 'sec' ? 'timeSec' : 'timeMin', { value: time.value }) })}` : ''}
      </p>
      {data.tooMany ? <p className={WARN_BOX}>{t('tooMany', { count: data.requests })}</p> : null}
    </section>
  );
}

function RunReport({ job, loading }: { job: CalendarDatesJob | null; loading: boolean }) {
  const t = useTranslations('calendar.datesForm');
  const fmtRange = useStayRangeFormatter();
  if (loading) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  if (!job) return <p className={WARN_BOX}>{t('lost')}</p>;
  const running = job.state === 'running';
  const pct = job.total ? Math.round(((job.sent + job.failed.length) / job.total) * 100) : 100;
  const mismatched = job.verify?.mismatched ?? [];
  /** What Booking accepted; the plan only while it is still being sent. */
  const counts = job.applied ?? job.changes;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {fmtRange(job.dateFrom, addDaysYmd(job.dateToExclusive, -1))} · {t(job.action === 'open' ? 'actionOpen' : 'actionClose')}
        {job.source === 'auto' ? ` · ${t('sourceAuto')}` : ''}
      </p>
      {running ? (
        <>
          <p className="text-sm">{job.phase === 'verifying' ? t('verifying') : t('progress', { sent: job.sent + job.failed.length, total: job.total })}</p>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">{t('runHint')}</p>
        </>
      ) : (
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
              job.state === 'done' && mismatched.length === 0 && job.failed.length === 0
                ? 'bg-emerald-100 dark:bg-emerald-500/15'
                : job.state === 'done'
                  ? 'bg-amber-100 dark:bg-amber-500/15'
                  : 'bg-red-100 dark:bg-red-500/15',
            )}
          >
            {job.state === 'done' && mismatched.length === 0 && job.failed.length === 0 ? (
              <Check className="h-5 w-5 text-emerald-700 dark:text-emerald-400" aria-hidden />
            ) : (
              <AlertTriangle className={cn('h-5 w-5', job.state === 'done' ? 'text-amber-700' : 'text-red-700')} aria-hidden />
            )}
          </span>
          <div className="space-y-1">
            <p className="font-semibold">
              {job.state === 'stopped'
                ? t('stoppedTitle')
                : job.state === 'failed'
                  ? t('failedTitle')
                  : job.total === 0
                    ? t(job.action === 'close' ? 'doneRemembered' : 'doneNothing')
                    : t(job.action === 'open' ? 'doneOpen' : 'doneClose')}
            </p>
            {job.total > 0 ? (
              <p className="text-sm text-muted-foreground">
                {[
                  counts.open ? t('changeOpenDone', { count: counts.open }) : null,
                  counts.close ? t('changeCloseDone', { count: counts.close }) : null,
                  counts.price ? t('changePriceDone', { count: counts.price }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            ) : null}
          </div>
        </div>
      )}
      {job.state === 'stopped' ? <p className={BAD_BOX}>{t('stopped')}</p> : null}
      {job.failed.length > 0 ? (
        <div className={cn(BAD_BOX, 'space-y-1')}>
          <p className="font-semibold">{t('failedList')}</p>
          {job.failed.map((f) => (
            <p key={f.dateFrom} className="text-[13px]">
              {fmtRange(f.dateFrom, addDaysYmd(f.dateToExclusive, -1))} — {f.detail}
            </p>
          ))}
        </div>
      ) : null}
      {job.verify ? (
        job.verify.error ? (
          <p className={WARN_BOX}>{t('verifyError', { error: job.verify.error })}</p>
        ) : mismatched.length > 0 ? (
          <p className={WARN_BOX}>
            {t('verifyMismatch', {
              count: mismatched.length,
              dates: mismatched.slice(0, 8).map((d) => fmtRange(d, d)).join(', ') + (mismatched.length > 8 ? '…' : ''),
            })}
          </p>
        ) : (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">{t('verifyOk', { count: job.verify.checked })}</p>
        )
      ) : null}
    </div>
  );
}

function AutoOpenCard({ propertyId, currency }: { propertyId: string; currency: string | null }) {
  const t = useTranslations('calendar.datesForm.auto');
  const fmtRange = useStayRangeFormatter();
  const fmtPrice = usePriceFormatter();
  const auto = useAutoOpen(propertyId, true);
  const { saveAuto } = useCalendarDatesMutations();
  const s = auto.data?.settings ?? null;

  const [enabled, setEnabled] = useState(false);
  const [horizon, setHorizon] = useState<number>(90);
  const [price, setPrice] = useState('');
  const [weekend, setWeekend] = useState('');

  useEffect(() => {
    setEnabled(s?.enabled ?? false);
    setHorizon(s?.horizonDays ?? 90);
    setPrice(s?.price != null ? String(s.price) : '');
    setWeekend(s?.weekendPrice != null ? String(s.weekendPrice) : '');
  }, [s, propertyId]);
  /** A longer horizon while switched on: the next night opens the whole difference at once. */
  const grows = !!s?.enabled && enabled && horizon > s.horizonDays;

  const priceNum = parsePrice(price);
  const weekendNum = weekend.trim() ? parsePrice(weekend) : null;
  const weekendBad = weekend.trim() !== '' && weekendNum == null;
  const canSave = priceNum != null && !weekendBad && !saveAuto.isPending;

  const save = async () => {
    if (priceNum == null) return;
    try {
      await saveAuto.mutateAsync({ propertyId, enabled, horizonDays: horizon, price: priceNum, weekendPrice: weekendNum });
      toast.success(t('saved'));
    } catch (e) {
      toast.error(getApiErrorMessage(e) ?? t('error'));
    }
  };

  const last = s?.lastResult ?? null;
  const lastDate = last ? fmtRange(last.at.slice(0, 10), last.at.slice(0, 10)) : '';

  return (
    <section className="space-y-3 rounded-xl border border-dashed border-border px-3.5 py-3">
      <SectionTitle>{t('title')}</SectionTitle>
      {auto.isError ? (
        <p className={WARN_BOX}>{getApiErrorMessage(auto.error) ?? t('error')}</p>
      ) : auto.isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t('hint')}</p>
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
            <span className="text-sm font-medium">{t('toggle')}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {HORIZON_PRESETS.map((d) => (
              <ChoiceChip key={d} selected={horizon === d} onClick={() => setHorizon(d)}>
                {t(`horizon.${d}`)}
              </ChoiceChip>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              {t('price', { currency: currency ?? '' })}
              <Input inputMode="decimal" value={price} placeholder="0" onChange={(e) => setPrice(e.target.value)} />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              {t('weekendPrice', { currency: currency ?? '' })}
              <Input inputMode="decimal" value={weekend} placeholder={t('optional')} onChange={(e) => setWeekend(e.target.value)} />
            </label>
          </div>
          {s?.enabled && s.openedUntil ? (
            <p className="text-xs text-muted-foreground">{t('openedUntil', { date: fmtRange(s.openedUntil, s.openedUntil) })}</p>
          ) : null}
          {last ? (
            <p className="text-xs text-muted-foreground">
              {last.error === 'BUSY'
                ? t('lastBusy', { date: lastDate })
                : last.error
                  ? t('lastError', { date: lastDate, error: last.error })
                  : last.dryRun
                    ? t('lastDry', { date: lastDate, opened: last.opened })
                    : t('lastRun', { date: lastDate, opened: last.opened, failed: last.failed })}
            </p>
          ) : null}
          {s && s.keepClosed > 0 ? <p className="text-xs text-muted-foreground">{t('keepClosed', { count: s.keepClosed })}</p> : null}
          {grows ? <p className={WARN_BOX}>{t('horizonGrows', { days: horizon - s!.horizonDays })}</p> : null}
          {auto.data?.dryRun ? <p className={WARN_BOX}>{t('dryRunNote')}</p> : null}
          {priceNum != null ? (
            <p className="text-xs text-muted-foreground">
              {t('summary', {
                days: horizon,
                price: fmtPrice(priceNum, currency),
                weekend: weekendNum != null ? fmtPrice(weekendNum, currency) : fmtPrice(priceNum, currency),
              })}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={!canSave}>
              {saveAuto.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {t('save')}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
