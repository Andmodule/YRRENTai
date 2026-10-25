'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getApiErrorMessage } from '@/lib/api/error-message';
import { cn } from '@/lib/utils';
import { pricingKeys, useBasePriceMutations, useGuestPriceMutations } from '@/modules/pricing/hooks';
import type { BasePriceOverview, BookingWeekday, GuestPriceChannel } from '@/modules/pricing/api';
import { ChoiceChip } from '@/modules/pricing/components/shared';
import { WEEKDAYS, weekdayOf, ymdToDate } from '@/modules/pricing/lib/pricing-ui';
import { useCalendarDatesJob, type CalendarDatesPreview } from '../calendar-dates-api';
import type { MonthNight } from '../lib/property-month';

type Preview = CalendarDatesPreview & { fingerprint: string };

/** Day of the week as the server counts it (0 = Sunday … 6 = Saturday). */
const JS_DAY: Record<BookingWeekday, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** «12,5» / «12.5» → 12.5; empty → null; anything else → NaN. */
function parseNumber(s: string): number | null {
  const v = s.trim().replace(',', '.');
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * «Базовая цена» for the picked nights: the property's own price (for two guests), days of the week,
 * prices typed for one channel on these nights, channel markups, and «Отправить в Booking».
 * Saving a price shows at once what changes on Booking, with the send button next to it; nothing reaches
 * Booking without that second click (the server also refuses a send whose prices changed since the check).
 */
export function BasePricePanel({
  propertyId,
  picked,
  monthFrom,
  monthTo,
  today,
  data,
  typed,
  currency,
  minPrice,
  belowMin,
}: {
  propertyId: string;
  picked: readonly MonthNight[];
  /** The month on screen — «Заполнить из Booking» fills it (from today on). */
  monthFrom: string;
  monthTo: string;
  today: string;
  data: BasePriceOverview;
  /** Prices typed per night and channel (from «Цена для гостя»). */
  typed: Record<GuestPriceChannel, Record<string, number>>;
  currency: string | null;
  minPrice: number | null;
  /** The picked stay on Booking (room after every discount + cleaning) when it falls below minimum × nights. */
  belowMin: { total: number; floor: number; nights: number } | null;
}) {
  const t = useTranslations('calendar.propertyMonth.basePrice');
  const tw = useTranslations('pricing.form.weekdayShort');
  const locale = useLocale();
  const fmt = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }), [locale]);
  const base = useBasePriceMutations(propertyId);
  const guest = useGuestPriceMutations(propertyId);
  const qc = useQueryClient();
  // The dates tool off: no runs to poll (the server would answer 503 on every pick).
  const job = useCalendarDatesJob(propertyId, data.bookingSend !== 'DATES_OFF');
  const [preview, setPreview] = useState<Preview | null>(null);
  const sendRef = useRef<HTMLDivElement>(null);
  // When a run ends, the calendar re-reads Booking (the «not sent» dots go away).
  const lastState = useRef<string | null>(null);
  useEffect(() => {
    const s = job.data?.state ?? null;
    if (lastState.current === 'running' && s && s !== 'running') {
      void qc.invalidateQueries({ queryKey: ['calendar'] });
      void qc.invalidateQueries({ queryKey: pricingKeys.basePrice(propertyId) });
    }
    lastState.current = s;
  }, [job.data?.state, qc, propertyId]);
  const [showRules, setShowRules] = useState(false);

  const from = picked[0]?.ymd ?? today;
  const to = picked[picked.length - 1]?.ymd ?? today;
  const range = from === to ? format(ymdToDate(from), 'dd.MM') : `${format(ymdToDate(from), 'dd.MM')}–${format(ymdToDate(to), 'dd.MM')}`;
  const values = picked.map((n) => data.base[n.ymd]).filter((v): v is number => v != null);
  const withoutBase = picked.length - values.length;
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;
  const fillFrom = monthFrom < today ? today : monthFrom;
  const datesOff = data.bookingSend === 'DATES_OFF';
  const sendBlock = data.bookingSend;
  const running = job.data?.state === 'running';
  // What Booking has now on each picked night — the preview shows «now → new».
  const nowOnBooking = useMemo(() => new Map(picked.map((n) => [n.ymd, n.rack])), [picked]);

  // Days of the week (only for a range that has more than one of them).
  const pickedDays = useMemo(() => new Set(picked.map((n) => weekdayOf(n.ymd))), [picked]);
  const dayChoice = WEEKDAYS.filter((d) => pickedDays.has(d));
  const [days, setDays] = useState<Set<BookingWeekday>>(() => new Set(WEEKDAYS));
  const chosenDays = dayChoice.filter((d) => days.has(d));
  const weekdays = chosenDays.length === dayChoice.length ? undefined : chosenDays.map((d) => JS_DAY[d]);

  const fail = (e: unknown) => toast.error(getApiErrorMessage(e) ?? t('saveError'));

  /** Asks the server what a send would change now; `scroll` brings the result into view (after a save). */
  const check = (scroll: boolean) =>
    base.previewBooking.mutate(
      { from, to },
      {
        onSuccess: (p) => {
          setPreview(p);
          if (scroll) requestAnimationFrame(() => sendRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
        },
        onError: (e) => {
          setPreview(null);
          fail(e);
        },
      },
    );
  // After a save the price goes on to Booking only with «Отправить»; when Booking cannot be sent to, a save only saves.
  const canCheck = !sendBlock && !running;

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label={t('title')}>
      <div className="flex items-baseline gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-semibold">{t('title')}</h3>
        <span className="text-xs text-muted-foreground">{range}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {min == null
          ? t('noneYet')
          : min === max
            ? t('now', { price: fmt.format(min), currency: currency ?? '' })
            : t('nowRange', { min: fmt.format(min), max: fmt.format(max!), currency: currency ?? '' })}
        {withoutBase > 0 && min != null ? ` ${t('someWithout', { count: withoutBase })}` : ''}
      </p>

      {dayChoice.length > 1 ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{t('weekdays')}</p>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((d) => (
              <ChoiceChip
                key={d}
                compact
                selected={pickedDays.has(d) && days.has(d)}
                disabled={!pickedDays.has(d)}
                onClick={() => {
                  const next = new Set(days);
                  if (next.has(d)) next.delete(d);
                  else next.add(d);
                  if (dayChoice.some((x) => next.has(x))) setDays(next);
                }}
              >
                {tw(d)}
              </ChoiceChip>
            ))}
          </div>
        </div>
      ) : null}

      <PriceForm
        key={`base|${from}|${to}`}
        label={t('baseLabel')}
        saveLabel={canCheck ? t('saveBaseAndCheck') : t('saveBase')}
        clearLabel={t('clearBase')}
        pending={base.setRange.isPending}
        onSave={(price) =>
          base.setRange.mutate(
            { from, to, price, ...(weekdays ? { weekdays } : {}) },
            {
              onSuccess: () => {
                if (price != null && canCheck) {
                  toast.success(t('baseSavedChecking'));
                  check(true);
                } else {
                  setPreview(null);
                  toast.success(price == null ? t('baseCleared') : t('baseSaved'));
                }
              },
              onError: fail,
            },
          )
        }
      />

      <div ref={sendRef} className="space-y-2 rounded-lg border border-border p-3">
        <h4 className="text-xs font-semibold">{t('sendTitle')}</h4>
        {sendBlock ? <p className="text-xs text-amber-700 dark:text-amber-400">{t(`block.${sendBlock}`)}</p> : null}

        {preview ? (
          <div className="space-y-1.5 text-xs">
            <p className="font-medium">
              {preview.changes.price > 0 ? t('previewChanges', { count: preview.changes.price }) : t('previewNothing')}
            </p>
            {preview.ranges.length > 0 ? (
              <ul className="space-y-0.5 tabular-nums">
                {preview.ranges.map((r) => {
                  const now = r.nights === 1 ? nowOnBooking.get(r.dateFrom) : null;
                  return (
                    <li key={r.dateFrom}>
                      {format(ymdToDate(r.dateFrom), 'dd.MM')}
                      {r.nights > 1 ? `–${format(ymdToDate(addDays(r.dateToExclusive, -1)), 'dd.MM')}` : ''}:{' '}
                      {now != null ? `${fmt.format(now)} → ` : '→ '}
                      <span className="font-semibold">{fmt.format(r.price)}</span> {preview.currency}
                    </li>
                  );
                })}
                {preview.requests > preview.ranges.length ? <li>…</li> : null}
              </ul>
            ) : null}
            <SkippedLine skipped={preview.skipped} />
            {preview.tooMany ? <p className="text-amber-700 dark:text-amber-400">{t('tooMany')}</p> : null}
            {preview.changes.price > 0 && !preview.tooMany ? (
              <Button
                type="button"
                size="sm"
                className="mt-1 gap-1.5"
                disabled={!!sendBlock || base.sendBooking.isPending || running}
                onClick={() =>
                  base.sendBooking.mutate(
                    { from, to, fingerprint: preview.fingerprint },
                    {
                      onSuccess: () => {
                        setPreview(null);
                        toast.success(t('sendStarted'));
                      },
                      onError: (e) => {
                        // 409: the prices changed since the check — the next click checks again.
                        setPreview(null);
                        fail(e);
                      },
                    },
                  )
                }
              >
                <Send className="h-3.5 w-3.5" aria-hidden />
                {t('send', { count: preview.changes.price })}
              </Button>
            ) : null}
          </div>
        ) : null}

        <Button type="button" size="sm" variant="outline" disabled={datesOff || base.previewBooking.isPending || running} onClick={() => check(false)}>
          {base.previewBooking.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          {preview ? t('checkAgain', { range }) : t('check', { range })}
        </Button>

        {belowMin && minPrice ? (
          <p className="rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
            {t('belowMinStay', {
              nights: belowMin.nights,
              total: fmt.format(belowMin.total),
              floor: fmt.format(belowMin.floor),
              min: fmt.format(minPrice),
              currency: currency ?? '',
            })}
          </p>
        ) : null}

        {job.data && job.data.action === 'price' ? (
          <p
            className={cn(
              'rounded-lg px-3 py-2 text-xs',
              job.data.state === 'done' && job.data.failed.length === 0 && !job.data.verify?.mismatched.length
                ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200'
                : job.data.state === 'running'
                  ? 'bg-muted'
                  : 'bg-amber-50 text-amber-950 dark:bg-amber-500/10 dark:text-amber-100',
            )}
          >
            {job.data.state === 'running'
              ? t('jobRunning', { sent: job.data.sent, total: job.data.total })
              : t('jobDone', {
                  state: t(`jobState.${job.data.state}`),
                  applied: job.data.applied?.price ?? 0,
                  mismatched: job.data.verify?.mismatched.length ?? 0,
                  failed: job.data.failed.length,
                })}
          </p>
        ) : null}
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <h4 className="text-xs font-semibold">{t('typedTitle')}</h4>
        {(['booking', 'airbnb'] as const).map((channel) => {
          const typedHere = picked.filter((n) => typed[channel][n.ymd] != null).length;
          return (
            <PriceForm
              key={`${channel}|${from}|${to}`}
              label={t(channel === 'booking' ? 'typedBooking' : 'typedAirbnb', { count: typedHere })}
              saveLabel={t('saveTyped')}
              clearLabel={t('clearTyped')}
              pending={guest.setNightPrices.isPending && guest.setNightPrices.variables?.channel === channel}
              onSave={(price) =>
                guest.setNightPrices.mutate(
                  { from, to, price, channel },
                  {
                    onSuccess: () => {
                      toast.success(price == null ? t('typedCleared') : t('typedSaved'));
                      // A Booking price changes what a send would do: check again at once.
                      if (channel === 'booking' && price != null && canCheck) check(true);
                      else setPreview(null);
                    },
                    onError: fail,
                  },
                )
              }
            />
          );
        })}
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={datesOff || fillFrom > monthTo || base.fillFromBooking.isPending}
            onClick={() =>
              base.fillFromBooking.mutate(
                { from: fillFrom, to: monthTo },
                {
                  onSuccess: (r) => {
                    setPreview(null);
                    toast.success(t('filled', { filled: r.filled, kept: r.kept, notOpen: r.notOpen }));
                  },
                  onError: fail,
                },
              )
            }
          >
            {base.fillFromBooking.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            {t('fillFromBooking')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setShowRules((v) => !v)} aria-expanded={showRules}>
            {t('rulesToggle')}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">{t('fillHint')}</p>

        {showRules ? (
          <div className="space-y-3 rounded-lg bg-muted/50 p-3">
            {(['booking', 'airbnb'] as const).map((channel) => (
              <ChannelRuleForm
                key={`${channel}|${data.channels[channel].isDefault}`}
                channel={channel}
                rule={data.channels[channel]}
                pending={base.saveChannel.isPending && base.saveChannel.variables?.channel === channel}
                onSave={(input) =>
                  base.saveChannel.mutate(
                    { channel, input },
                    {
                      onSuccess: () => {
                        setPreview(null);
                        toast.success(t('rulesSaved'));
                      },
                      onError: fail,
                    },
                  )
                }
              />
            ))}
            <p className="text-[11px] text-muted-foreground">{t('rulesHint')}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function addDays(ymd: string, days: number): string {
  const d = new Date(Date.parse(`${ymd}T12:00:00Z`) + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function SkippedLine({ skipped }: { skipped: CalendarDatesPreview['skipped'] }) {
  const t = useTranslations('calendar.propertyMonth.basePrice.skipped');
  const parts = (['unchanged', 'closed', 'crm', 'booked', 'belowMin', 'missing'] as const)
    .filter((k) => skipped[k] > 0)
    .map((k) => t(k, { count: skipped[k] }));
  return parts.length ? <p className="text-muted-foreground">{parts.join(' · ')}</p> : null;
}

function PriceForm({
  label,
  saveLabel,
  clearLabel,
  pending,
  onSave,
}: {
  label: string;
  saveLabel: string;
  clearLabel: string;
  pending: boolean;
  onSave: (price: number | null) => void;
}) {
  const t = useTranslations('calendar.propertyMonth.basePrice');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = parseNumber(value);
    if (n == null || Number.isNaN(n) || n <= 0) {
      setError(t('priceError'));
      return;
    }
    onSave(n);
  };
  return (
    <form onSubmit={submit} className="space-y-1" noValidate>
      <label className="block text-xs text-muted-foreground">{label}</label>
      <div className="flex flex-wrap items-center gap-2">
        {/* `cn` only joins classes: the Input's own w-full wins over a width given to it — size the wrapper. */}
        <div className="w-28 shrink-0">
          <Input
            className="h-9"
            inputMode="decimal"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            aria-label={label}
            aria-invalid={!!error}
          />
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          {saveLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => onSave(null)}>
          {clearLabel}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  );
}

function ChannelRuleForm({
  channel,
  rule,
  pending,
  onSave,
}: {
  channel: GuestPriceChannel;
  rule: BasePriceOverview['channels'][GuestPriceChannel];
  pending: boolean;
  onSave: (input: { markupPct: number; singleGuestPct: number | null; extraGuestPct: number | null }) => void;
}) {
  const t = useTranslations('calendar.propertyMonth.basePrice');
  const [markup, setMarkup] = useState(String(rule.markupPct));
  const [single, setSingle] = useState(rule.singleGuestPct == null ? '' : String(rule.singleGuestPct));
  const [extra, setExtra] = useState(rule.extraGuestPct == null ? '' : String(rule.extraGuestPct));
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const m = parseNumber(markup);
    const s = parseNumber(single);
    const x = parseNumber(extra);
    const whole = (v: number | null, lo: number, hi: number) => v == null || (Number.isInteger(v) && v >= lo && v <= hi);
    if (m == null || !whole(m, -50, 200) || !whole(s, 0, 90) || !whole(x, 0, 200)) {
      setError(t('ruleError'));
      return;
    }
    setError(null);
    onSave({ markupPct: m, singleGuestPct: s, extraGuestPct: x });
  };
  return (
    <form onSubmit={submit} className="space-y-1.5" noValidate>
      <h4 className="text-xs font-semibold">{channel === 'booking' ? 'Booking' : 'Airbnb'}</h4>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: t('fMarkup'), value: markup, set: setMarkup },
          { label: t('fSingle'), value: single, set: setSingle },
          { label: t('fExtra'), value: extra, set: setExtra },
        ].map((f) => (
          <label key={f.label} className="space-y-1 text-xs">
            <span className="text-muted-foreground">{f.label}</span>
            <Input
              className="h-9"
              inputMode="numeric"
              value={f.value}
              onChange={(e) => {
                f.set(e.target.value);
                setError(null);
              }}
            />
          </label>
        ))}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
        {t('rulesSave')}
      </Button>
    </form>
  );
}
