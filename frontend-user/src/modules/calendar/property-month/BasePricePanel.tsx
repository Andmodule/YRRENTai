'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { format } from 'date-fns';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getApiErrorMessage } from '@/lib/api/error-message';
import { cn } from '@/lib/utils';
import { useBasePriceMutations, useGuestPriceMutations } from '@/modules/pricing/hooks';
import type { BasePriceOverview, GuestPriceChannel } from '@/modules/pricing/api';
import { ymdToDate } from '@/modules/pricing/lib/pricing-ui';
import { useCalendarDatesJob, type CalendarDatesPreview } from '../calendar-dates-api';
import type { MonthNight } from '../lib/property-month';

/** «12,5» / «12.5» → 12.5; empty → null; anything else → NaN. */
function parseNumber(s: string): number | null {
  const v = s.trim().replace(',', '.');
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * «Базовая цена» for the picked nights: the property's own price (for two guests), prices typed for one
 * channel on these nights, channel markups, and «Отправить в Booking» — preview first, then a run of the
 * «Открыть / закрыть даты» kind. Nothing reaches Booking without the second click.
 */
export function BasePricePanel({
  propertyId,
  picked,
  monthNights,
  today,
  data,
  typed,
  currency,
}: {
  propertyId: string;
  picked: readonly MonthNight[];
  /** All nights of the month on screen — «Заполнить из Booking» takes them. */
  monthNights: readonly MonthNight[];
  today: string;
  data: BasePriceOverview;
  /** Prices typed per night and channel (from «Цена для гостя»). */
  typed: Record<GuestPriceChannel, Record<string, number>>;
  currency: string | null;
}) {
  const t = useTranslations('calendar.propertyMonth.basePrice');
  const locale = useLocale();
  const fmt = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }), [locale]);
  const base = useBasePriceMutations(propertyId);
  const guest = useGuestPriceMutations(propertyId);
  const job = useCalendarDatesJob(propertyId, true);
  const [preview, setPreview] = useState<CalendarDatesPreview | null>(null);
  const [showRules, setShowRules] = useState(false);

  const from = picked[0]?.ymd ?? today;
  const to = picked[picked.length - 1]?.ymd ?? today;
  const range = from === to ? format(ymdToDate(from), 'dd.MM') : `${format(ymdToDate(from), 'dd.MM')}–${format(ymdToDate(to), 'dd.MM')}`;
  const values = picked.map((n) => data.base[n.ymd]).filter((v): v is number => v != null);
  const withoutBase = picked.length - values.length;
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;
  // «Заполнить из Booking»: free nights of the month from today on that have a Booking price and no base yet.
  const fillable = useMemo(() => {
    const out: Record<string, number> = {};
    for (const n of monthNights) {
      if (n.ymd >= today && n.rack != null && n.rack > 0 && data.base[n.ymd] == null) out[n.ymd] = n.rack;
    }
    return out;
  }, [monthNights, today, data.base]);
  const fillCount = Object.keys(fillable).length;

  const fail = (e: unknown) => toast.error(getApiErrorMessage(e) ?? t('saveError'));
  const running = job.data?.state === 'running';
  const sendBlock = data.bookingSend;

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

      <PriceForm
        key={`base|${from}|${to}`}
        label={t('baseLabel')}
        saveLabel={t('saveBase')}
        clearLabel={t('clearBase')}
        pending={base.setRange.isPending}
        onSave={(price) =>
          base.setRange.mutate(
            { from, to, price },
            { onSuccess: () => toast.success(price == null ? t('baseCleared') : t('baseSaved')), onError: fail },
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={fillCount === 0 || base.setNights.isPending}
          onClick={() =>
            base.setNights.mutate(fillable, {
              onSuccess: () => toast.success(t('filled', { count: fillCount })),
              onError: fail,
            })
          }
        >
          {base.setNights.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          {t('fillFromBooking', { count: fillCount })}
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
                base.saveChannel.mutate({ channel, input }, { onSuccess: () => toast.success(t('rulesSaved')), onError: fail })
              }
            />
          ))}
          <p className="text-[11px] text-muted-foreground">{t('rulesHint')}</p>
        </div>
      ) : null}

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
                  { onSuccess: () => toast.success(price == null ? t('typedCleared') : t('typedSaved')), onError: fail },
                )
              }
            />
          );
        })}
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <h4 className="text-xs font-semibold">{t('sendTitle')}</h4>
        {sendBlock ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">{t(`block.${sendBlock}`)}</p>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={base.previewBooking.isPending || running}
          onClick={() =>
            base.previewBooking.mutate({ from, to }, { onSuccess: (p) => setPreview(p), onError: (e) => { setPreview(null); fail(e); } })
          }
        >
          {base.previewBooking.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          {t('check', { range })}
        </Button>

        {preview ? (
          <div className="space-y-1.5 rounded-lg bg-muted/50 p-3 text-xs">
            <p className="font-medium">
              {preview.changes.price > 0 ? t('previewChanges', { count: preview.changes.price, requests: preview.requests }) : t('previewNothing')}
            </p>
            {preview.ranges.length > 0 ? (
              <ul className="space-y-0.5 tabular-nums">
                {preview.ranges.map((r) => (
                  <li key={r.dateFrom}>
                    {format(ymdToDate(r.dateFrom), 'dd.MM')}
                    {r.nights > 1 ? `–${format(ymdToDate(addDays(r.dateToExclusive, -1)), 'dd.MM')}` : ''} → {fmt.format(r.price)} {preview.currency}
                    {r.closed ? ` · ${t('stillClosed')}` : ''}
                  </li>
                ))}
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
                    { from, to },
                    { onSuccess: () => { setPreview(null); toast.success(t('sendStarted')); }, onError: fail },
                  )
                }
              >
                <Send className="h-3.5 w-3.5" aria-hidden />
                {t('send', { count: preview.changes.price })}
              </Button>
            ) : null}
          </div>
        ) : null}

        {job.data && job.data.action === 'price' ? (
          <p
            className={cn(
              'rounded-lg px-3 py-2 text-xs',
              job.data.state === 'done' && !(job.data.verify?.mismatched.length)
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
    </section>
  );
}

function addDays(ymd: string, days: number): string {
  const d = new Date(Date.parse(`${ymd}T12:00:00Z`) + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function SkippedLine({ skipped }: { skipped: CalendarDatesPreview['skipped'] }) {
  const t = useTranslations('calendar.propertyMonth.basePrice.skipped');
  const parts = (['unchanged', 'crm', 'booked', 'belowMin', 'missing'] as const)
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
        <Input
          className="h-9 w-28"
          inputMode="decimal"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          aria-label={label}
          aria-invalid={!!error}
        />
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
