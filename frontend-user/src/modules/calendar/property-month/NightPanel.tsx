'use client';

import { useMemo, type ReactNode } from 'react';
import { format } from 'date-fns';
import { useTranslations } from 'next-intl';
import { CalendarPlus, Coins, Info, LockOpen, Percent, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDateLocale } from '@/hooks/useDateLocale';
import { cn } from '@/lib/utils';
import { isNotSent, isTargetingType, nightsCount, ymdToDate } from '@/modules/pricing/lib/pricing-ui';
import { usePriceFormatter, useStayRangeFormatter } from '@/modules/pricing/components/shared';
import type { Reservation } from '../types';
import { inSelection, type MonthNight, type MonthSummary, type NightSelection } from '../lib/property-month';

export type NightPanelActions = {
  onSetPrice?: () => void;
  onDiscount?: () => void;
  onOpenDates?: () => void;
  onNewBooking: () => void;
  onOpenReservation: (r: Reservation) => void;
  /** Discounts of one night in detail (switch-off per property). */
  onNightDiscounts?: (ymd: string) => void;
};

export type NightActionKey = 'price' | 'discount' | 'dates' | 'booking';

/** «С» / «По» of the picked nights, inside the month on screen. */
export type NightRangeControl = {
  min: string;
  max: string;
  onChange: (field: 'from' | 'to', value: string) => void;
};

/**
 * Booking-style date fields for the picked nights. On a computer a date applies when the field is left or Enter is pressed:
 * applying it on every keystroke broke typing in Chrome (the half-typed «1» of «15» swapped the range ends and
 * reset the field). `key` brings a new value in when the range changes elsewhere (a drag, a tap).
 */
export function RangeFields({ selection, range }: { selection: NightSelection; range: NightRangeControl }) {
  const t = useTranslations('calendar.propertyMonth');
  const field = (which: 'from' | 'to', value: string, label: string) => (
    <label className="space-y-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <Input
        key={value}
        type="date"
        className="h-10"
        defaultValue={value}
        min={range.min}
        max={range.max}
        onChange={(e) => {
          // A phone picks a date in its own picker (no half-typed values): apply at once.
          if (window.matchMedia('(pointer: coarse)').matches && e.currentTarget.value !== value) {
            range.onChange(which, e.currentTarget.value);
          }
        }}
        onBlur={(e) => {
          // A field replaced after Enter (new `key`) must not apply its old value once more.
          if (e.currentTarget.isConnected && e.currentTarget.value !== value) range.onChange(which, e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.currentTarget.value !== value) {
            e.preventDefault();
            range.onChange(which, e.currentTarget.value);
          }
        }}
      />
    </label>
  );
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-2">
        {field('from', selection.from, t('rangeFrom'))}
        {field('to', selection.to, t('rangeTo'))}
      </div>
      <p className="text-[11px] text-muted-foreground">{t('rangeHint')}</p>
    </div>
  );
}

/** What the picked nights hold: the nights, their bookings and the discounts on them. */
export function usePickedNights(nights: readonly MonthNight[], selection: NightSelection | null) {
  const picked = useMemo(() => nights.filter((n) => inSelection(selection, n.ymd)), [nights, selection]);
  const bookings = useMemo(() => {
    const seen = new Map<string, Reservation>();
    for (const n of picked) if (n.reservation && !seen.has(n.reservation.uuid)) seen.set(n.reservation.uuid, n.reservation);
    return [...seen.values()];
  }, [picked]);
  const discounts = useMemo(() => {
    const seen = new Map<string, MonthNight['promotions'][number]>();
    for (const n of picked) for (const p of n.promotions) if (!seen.has(p.id)) seen.set(p.id, p);
    // The deals a regular guest gets first; Mobile / Country rates (a part of the guests) after them.
    return [...seen.values()].sort((a, b) => Number(isTargetingType(a.promotionType)) - Number(isTargetingType(b.promotionType)));
  }, [picked]);
  const allPast = picked.length > 0 && picked.every((n) => n.past);
  return { picked, bookings, discounts, allPast };
}

/** Right-hand panel: what is picked, what can be done with it, and what each guest pays. */
export function NightPanel({
  nights,
  selection,
  summary,
  currency,
  geniusPct,
  minPrice,
  linked,
  ariUnavailable,
  actions,
  onClear,
  range,
  guestPrice,
  basePrice,
  hideBelowMin = false,
}: {
  nights: readonly MonthNight[];
  selection: NightSelection | null;
  summary: MonthSummary;
  currency: string | null;
  geniusPct: number | null;
  minPrice: number | null;
  linked: boolean;
  ariUnavailable: boolean;
  actions: NightPanelActions;
  onClear: () => void;
  /** «С» / «По» fields under the picked range. */
  range: NightRangeControl;
  /** «Цена для гостя» for the picked nights — shown under the table when the feature is on. */
  guestPrice?: ReactNode;
  /** «Базовая цена» for the picked nights — shown above «Цена для гостя» when the feature is on. */
  basePrice?: ReactNode;
  /** «Цена для гостя» checks the minimum for the whole stay (room + cleaning) — the per-night note is not shown. */
  hideBelowMin?: boolean;
}) {
  const t = useTranslations('calendar.propertyMonth');
  const fmtPrice = usePriceFormatter();
  const fmtRange = useStayRangeFormatter();

  const { picked, bookings, discounts, allPast } = usePickedNights(nights, selection);

  return (
    <div className="space-y-4">
      {!selection ? (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">{t('monthTitle')}</h2>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-muted px-2 py-2">
              <dt className="text-[11px] text-muted-foreground">{t('sumOpen')}</dt>
              <dd className="text-lg font-semibold tabular-nums">{summary.open}</dd>
            </div>
            <div className="rounded-lg bg-muted px-2 py-2">
              <dt className="text-[11px] text-muted-foreground">{t('sumBooked')}</dt>
              <dd className="text-lg font-semibold tabular-nums">{summary.booked}</dd>
            </div>
            <div className="rounded-lg bg-muted px-2 py-2">
              <dt className="text-[11px] text-muted-foreground">{t('sumClosed')}</dt>
              <dd className="text-lg font-semibold tabular-nums">{summary.closed}</dd>
            </div>
          </dl>
          {summary.avgOpenPrice != null ? (
            <p className="text-sm text-muted-foreground">{t('sumAvg', { price: fmtPrice(summary.avgOpenPrice, currency) })}</p>
          ) : null}
          <p className="text-sm text-muted-foreground">{t('pickHint')}</p>
          {!linked ? <p className="text-sm text-amber-700 dark:text-amber-400">{t('notLinked')}</p> : null}
        </section>
      ) : (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">{fmtRange(selection.from, selection.to)}</h2>
              <p className="text-xs text-muted-foreground">
                {t('nights', { count: nightsCount(selection.from, selection.to) })}
                {allPast ? ` · ${t('past')}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={onClear}
              aria-label={t('clear')}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <RangeFields selection={selection} range={range} />
          <NightActions actions={actions} allPast={allPast} />
          {!linked ? <p className="text-sm text-amber-700 dark:text-amber-400">{t('notLinked')}</p> : null}

          <NightBookings bookings={bookings} onOpen={actions.onOpenReservation} />
        </section>
      )}

      {selection && picked.length > 0 ? basePrice : null}
      {selection && picked.length > 0 ? guestPrice : null}

      {selection && picked.length > 0 ? (
        <NightPriceTable
          picked={picked}
          discounts={discounts}
          currency={currency}
          geniusPct={geniusPct}
          minPrice={minPrice}
          ariUnavailable={ariUnavailable}
          hideBelowMin={hideBelowMin}
          onNightDiscounts={actions.onNightDiscounts}
        />
      ) : null}

      <PriceLegend geniusPct={geniusPct} />
    </div>
  );
}

/** What can be done with the picked nights; `only` keeps a part of the buttons (the phone sheet splits them by tab). */
export function NightActions({
  actions,
  allPast,
  only,
}: {
  actions: NightPanelActions;
  allPast: boolean;
  only?: readonly NightActionKey[];
}) {
  const t = useTranslations('calendar.propertyMonth');
  const show = (k: NightActionKey) => !only || only.includes(k);
  return (
    <div className="grid gap-2">
      {actions.onSetPrice && show('price') ? (
        <Button type="button" variant="secondary" className="h-10 justify-start gap-2" disabled={allPast} onClick={actions.onSetPrice}>
          <Coins className="h-4 w-4" aria-hidden />
          {t('actSetPrice')}
        </Button>
      ) : null}
      {actions.onDiscount && show('discount') ? (
        <Button
          type="button"
          variant="outline"
          className="h-10 justify-start gap-2 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
          disabled={allPast}
          onClick={actions.onDiscount}
        >
          <Percent className="h-4 w-4" aria-hidden />
          {t('actDiscount')}
        </Button>
      ) : null}
      {actions.onOpenDates && show('dates') ? (
        <Button type="button" variant="secondary" className="h-10 justify-start gap-2" disabled={allPast} onClick={actions.onOpenDates}>
          <LockOpen className="h-4 w-4" aria-hidden />
          {t('actOpenDates')}
        </Button>
      ) : null}
      {show('booking') ? (
        <Button type="button" variant="secondary" className="h-10 justify-start gap-2" onClick={actions.onNewBooking}>
          <CalendarPlus className="h-4 w-4" aria-hidden />
          {t('actNewBooking')}
        </Button>
      ) : null}
    </div>
  );
}

/** Bookings on the picked nights — a tap opens the booking. */
export function NightBookings({ bookings, onOpen }: { bookings: readonly Reservation[]; onOpen: (r: Reservation) => void }) {
  const t = useTranslations('calendar.propertyMonth');
  const fmtRange = useStayRangeFormatter();
  if (bookings.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('bookings')}</h3>
      {bookings.map((r) => (
        <button
          key={r.uuid}
          type="button"
          onClick={() => onOpen(r)}
          className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 flex-1 truncate font-medium">
            {r.status === 'blocked' ? t('blockShort') : r.guestName}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {fmtRange(r.checkIn.slice(0, 10), r.checkOut.slice(0, 10))}
          </span>
        </button>
      ))}
    </div>
  );
}

/** «Где какая цена» for the picked nights: rate, deal, regular guest, Genius, app. */
export function NightPriceTable({
  picked,
  discounts,
  currency,
  geniusPct,
  minPrice,
  ariUnavailable,
  hideBelowMin = false,
  onNightDiscounts,
}: {
  picked: readonly MonthNight[];
  discounts: readonly MonthNight['promotions'][number][];
  currency: string | null;
  geniusPct: number | null;
  minPrice: number | null;
  ariUnavailable: boolean;
  hideBelowMin?: boolean;
  onNightDiscounts?: (ymd: string) => void;
}) {
  const t = useTranslations('calendar.propertyMonth');
  const dateLocale = useDateLocale();
  const fmtPrice = usePriceFormatter();
  const showApp = picked.some((n) => n.prices?.app != null);
  const belowMin = minPrice && !hideBelowMin
    ? picked.filter((n) => n.prices && Math.min(n.prices.genius, n.prices.app ?? Number.POSITIVE_INFINITY) < minPrice).length
    : 0;
  const single = picked.length === 1 ? picked[0]! : null;
  const dayLabel = (ymd: string) => format(ymdToDate(ymd), 'd MMM, EEEEEE', { locale: dateLocale });

  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">{t('tableTitle')}</h3>
      {ariUnavailable ? <p className="text-xs text-amber-700 dark:text-amber-400">{t('ariUnavailable')}</p> : null}
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[300px] border-separate border-spacing-x-1 text-xs tabular-nums">
          <thead>
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="py-1 font-medium">{t('colDate')}</th>
              <th className="py-1 text-right font-medium">{t('colRate')}</th>
              <th className="py-1 text-right font-medium">{t('colDeal')}</th>
              <th className="py-1 text-right font-medium">{t('colRegular')}</th>
              <th className="py-1 text-right font-medium">{geniusPct ? t('colGeniusPct', { pct: geniusPct }) : t('colGenius')}</th>
              {showApp ? <th className="py-1 text-right font-medium">{t('colApp')}</th> : null}
            </tr>
          </thead>
          <tbody>
            {picked.map((n) => {
              const p = n.prices;
              const span = showApp ? 4 : 3;
              return (
                <tr key={n.ymd} className={cn('align-top', n.past && 'opacity-55')}>
                  <td className="whitespace-nowrap py-1">{dayLabel(n.ymd)}</td>
                  <td className="whitespace-nowrap py-1 text-right">{n.rack != null ? fmtPrice(n.rack) : '—'}</td>
                  {p ? (
                    <>
                      <td className="whitespace-nowrap py-1 text-right">
                        {p.deal ? (
                          onNightDiscounts ? (
                            <button
                              type="button"
                              onClick={() => onNightDiscounts?.(n.ymd)}
                              className="font-semibold text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
                            >
                              −{p.deal.discountPct}%
                            </button>
                          ) : (
                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">−{p.deal.discountPct}%</span>
                          )
                        ) : n.promotions.length > 0 && onNightDiscounts ? (
                          <button
                            type="button"
                            onClick={() => onNightDiscounts?.(n.ymd)}
                            className="text-amber-700 underline underline-offset-2 dark:text-amber-400"
                            title={t('dealNotLive')}
                          >
                            0%*
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="whitespace-nowrap py-1 text-right font-semibold">{fmtPrice(p.regular)}</td>
                      <td className="whitespace-nowrap py-1 text-right">{fmtPrice(p.genius)}</td>
                      {showApp ? <td className="whitespace-nowrap py-1 text-right">{p.app != null ? fmtPrice(p.app) : '—'}</td> : null}
                    </>
                  ) : (
                    <td colSpan={span} className="py-1 text-right text-muted-foreground">
                      {n.kind === 'booked'
                        ? t('rowBooked', { name: n.reservation?.guestName ?? '' })
                        : n.kind === 'blocked'
                          ? t('blockShort')
                          : n.kind === 'closed'
                            ? t('rowClosed')
                            : t('rowNoPrice')}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {currency ? t('currencyNote', { currency }) : null} {t('noTaxes')}
      </p>
      {picked.some((n) => n.kind === 'open' && n.promotions.length > 0 && !n.prices?.deal) ? (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">* {t('dealNotLive')}</p>
      ) : null}
      {belowMin > 0 && minPrice ? (
        <p className="rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          {t('belowMin', { count: belowMin, min: fmtPrice(minPrice, currency) })}
        </p>
      ) : null}
      {single?.prices && single.rack != null ? (
        <ol className="space-y-1 rounded-lg bg-muted/60 px-3 py-2 text-xs">
          <li>{t('stepRate', { price: fmtPrice(single.rack, currency), rate: single.rateName ?? 'Standard' })}</li>
          <li>
            {single.prices.deal
              ? t('stepDeal', { name: single.prices.deal.name, pct: single.prices.deal.discountPct, price: fmtPrice(single.prices.regular, currency) })
              : t('stepNoDeal')}
          </li>
          <li>
            {geniusPct
              ? t('stepGenius', { pct: geniusPct, price: fmtPrice(single.prices.genius, currency) })
              : t('stepNoGenius')}
          </li>
          {single.prices.app != null && single.targetingPct ? (
            <li>{t('stepApp', { pct: single.targetingPct, price: fmtPrice(single.prices.app, currency) })}</li>
          ) : null}
        </ol>
      ) : null}
      {discounts.length > 0 ? (
        <ul className="space-y-1 text-xs">
          {discounts.map((p) => (
            <li key={p.id} className="flex flex-wrap gap-x-1.5">
              <span className="font-medium">«{p.name}» −{p.discountPct}%</span>
              <span className="text-muted-foreground">
                {isNotSent(p.state)
                  ? t('dState.notSent')
                  : isTargetingType(p.promotionType)
                    ? t('dState.targeting')
                    : p.state === 'on'
                      ? p.confirmed
                        ? t('dState.on')
                        : t('dState.unconfirmed')
                      : p.state === 'pending'
                        ? t('dState.pending')
                        : t('dState.dry')}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** «Где какая цена»: what each price is and where to find it on Booking. */
export function PriceLegend({ geniusPct }: { geniusPct: number | null }) {
  const t = useTranslations('calendar.propertyMonth.legend');
  const rows = [
    { name: t('rateName'), what: t('rateWhat'), where: t('rateWhere') },
    { name: t('dealName'), what: t('dealWhat'), where: t('dealWhere') },
    { name: t('regularName'), what: t('regularWhat'), where: t('regularWhere') },
    { name: t('geniusName'), what: geniusPct ? t('geniusWhatPct', { pct: geniusPct }) : t('geniusWhat'), where: t('geniusWhere') },
    { name: t('appName'), what: t('appWhat'), where: t('appWhere') },
  ];
  return (
    <details className="group space-y-2 rounded-xl border border-border bg-card p-4">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <Info className="h-4 w-4 text-muted-foreground" aria-hidden />
        {t('title')}
      </summary>
      <dl className="mt-2 space-y-2 text-xs">
        {rows.map((r) => (
          <div key={r.name}>
            <dt className="font-semibold">{r.name}</dt>
            <dd className="text-muted-foreground">{r.what}</dd>
            <dd className="text-muted-foreground">
              <span className="font-medium text-foreground/80">{t('whereLabel')}</span> {r.where}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-[11px] text-muted-foreground">{t('taxes')}</p>
      <p className="text-[11px] text-muted-foreground">{t('derived')}</p>
    </details>
  );
}
