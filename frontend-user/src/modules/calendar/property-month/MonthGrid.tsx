'use client';

import { useMemo } from 'react';
import { format } from 'date-fns';
import { useLocale, useTranslations } from 'next-intl';
import { useDateLocale } from '@/hooks/useDateLocale';
import { cn } from '@/lib/utils';
import { isNotSent, isTargetingType, liveDeal, ymdToDate } from '@/modules/pricing/lib/pricing-ui';
import type { BookingCell } from '@/modules/pricing/lib/guest-price';
import type { BookingChannel } from '../types';
import { inSelection, type MonthNight, monthWeeks, type NightSelection } from '../lib/property-month';

/** Booked nights are tinted by channel, like the bars of the general calendar. */
const CHANNEL_TONE: Record<BookingChannel, string> = {
  booking: 'bg-blue-100 text-blue-950 dark:bg-blue-500/20 dark:text-blue-100',
  airbnb: 'bg-rose-100 text-rose-950 dark:bg-rose-500/20 dark:text-rose-100',
  direct: 'bg-emerald-100 text-emerald-950 dark:bg-emerald-500/20 dark:text-emerald-100',
  other: 'bg-amber-100 text-amber-950 dark:bg-amber-500/20 dark:text-amber-100',
};

/** Discount badge: green only when Booking really shows it; the rest say what is going on. */
function badgeTone(n: MonthNight): { pct: number; tone: string } | null {
  const live = liveDeal(n.promotions);
  if (live) return { pct: live.discountPct, tone: 'bg-emerald-600 text-white' };
  const top = n.promotions.find((p) => !isTargetingType(p.promotionType));
  if (!top) return null;
  if (isNotSent(top.state)) {
    return { pct: top.discountPct, tone: 'border border-dashed border-red-500 text-red-700 line-through dark:text-red-300' };
  }
  if (top.state === 'pending') return { pct: top.discountPct, tone: 'bg-sky-600 text-white' };
  if (top.state === 'on') return { pct: top.discountPct, tone: 'border border-amber-500 text-amber-800 dark:text-amber-200' };
  return { pct: top.discountPct, tone: 'border border-dashed border-violet-500 text-violet-800 dark:text-violet-200' };
}

/** «Базовая цена»: the three price rows of a cell. */
export type CellRows = {
  base: number | null;
  booking: BookingCell | null;
  /** Airbnb's price for the night (typed, from the base, or from the settings). */
  airbnb: number | null;
  airbnbTyped: boolean;
};

export function MonthGrid({
  month,
  nights,
  selection,
  onPick,
  rows,
}: {
  /** yyyy-MM */
  month: string;
  nights: readonly MonthNight[];
  selection: NightSelection | null;
  onPick: (ymd: string) => void;
  /** When set, a free future night shows base / Booking / Airbnb instead of the single guest price. */
  rows?: ReadonlyMap<string, CellRows>;
}) {
  const t = useTranslations('calendar.propertyMonth');
  const dateLocale = useDateLocale();
  const locale = useLocale();
  const fmt = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }), [locale]);
  const weeks = useMemo(() => monthWeeks(month), [month]);
  const byDay = useMemo(() => new Map(nights.map((n) => [n.ymd, n])), [nights]);
  // 2024-01-01 is a Monday: the header row follows the grid, Monday first.
  const weekdays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => format(new Date(2024, 0, 1 + i), 'EEEEEE', { locale: dateLocale })),
    [dateLocale],
  );

  return (
    <div className="min-w-0" role="grid" aria-label={t('gridAria')}>
      <div className="grid grid-cols-7 gap-1 pb-1" role="row">
        {weekdays.map((w, i) => (
          <div
            key={w}
            role="columnheader"
            className={cn('px-1 text-center text-xs font-medium capitalize text-muted-foreground', i >= 5 && 'text-foreground')}
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid gap-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1" role="row">
            {week.map((ymd, di) => {
              if (!ymd) return <div key={`e${di}`} aria-hidden />;
              const n = byDay.get(ymd);
              const selected = inSelection(selection, ymd);
              const badge = n?.kind === 'open' ? badgeTone(n) : null;
              const res = n?.reservation ?? null;
              const busy = n?.kind === 'booked' || n?.kind === 'blocked';
              const deal = n?.prices?.deal ?? null;
              const row = rows && n && !n.past && !busy ? rows.get(ymd) : undefined;
              return (
                <button
                  key={ymd}
                  type="button"
                  role="gridcell"
                  aria-selected={selected}
                  onClick={() => onPick(ymd)}
                  title={format(ymdToDate(ymd), 'EEEE, d MMMM', { locale: dateLocale })}
                  className={cn(
                    'relative flex min-h-[72px] min-w-0 flex-col rounded-lg border p-1 text-left transition-colors sm:min-h-[92px] sm:p-1.5',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected ? 'border-primary bg-primary/10 ring-2 ring-inset ring-primary' : 'border-border bg-card hover:border-primary/50',
                    n?.kind === 'closed' && !selected && 'bg-muted/70',
                    n?.past && 'opacity-55',
                  )}
                >
                  {/* Phone: the badge goes under the day number — a column is too narrow for both. */}
                  <span className="flex flex-col items-start gap-0.5 sm:flex-row sm:justify-between sm:gap-1">
                    <span
                      className={cn(
                        'inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-semibold sm:text-sm',
                        n?.today && 'bg-primary px-1.5 text-primary-foreground',
                      )}
                    >
                      {Number(ymd.slice(8))}
                    </span>
                    {badge ? (
                      <span className={cn('max-w-full rounded px-0.5 text-[10px] font-bold leading-4 sm:px-1 sm:text-[11px]', badge.tone)}>
                        −{badge.pct}%
                      </span>
                    ) : null}
                  </span>

                  {busy && res ? (
                    <span
                      className={cn(
                        'mt-1 truncate rounded px-1 text-[10px] font-medium leading-4 sm:text-[11px]',
                        n?.kind === 'blocked' ? 'bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100' : CHANNEL_TONE[res.channel],
                      )}
                    >
                      {n?.kind === 'blocked' ? t('blockShort') : n?.arrival ? res.guestName : '···'}
                    </span>
                  ) : n?.kind === 'closed' ? (
                    <span className="mt-1 truncate text-[10px] font-medium text-muted-foreground sm:text-[11px]">{t('closedShort')}</span>
                  ) : null}

                  {row ? (
                    <span className="mt-auto grid gap-px text-right text-[10px] leading-[14px] tabular-nums sm:text-[11px]">
                      {row.base != null ? (
                        <span className="font-semibold text-foreground">{fmt.format(row.base)}</span>
                      ) : (
                        <span className="font-semibold text-foreground">
                          <span className="hidden sm:inline">—</span>
                          {/* Phone shows one row: without a base price it is the guest price, as before base prices. */}
                          <span className={cn('sm:hidden', deal && 'text-emerald-700 dark:text-emerald-400')}>
                            {n?.prices ? fmt.format(n.prices.regular) : '—'}
                          </span>
                        </span>
                      )}
                      <span className="hidden text-blue-700 dark:text-blue-300 sm:block" title={t('rowBookingTitle')}>
                        {row.booking ? (
                          <>
                            {row.booking.pending ? <span className="mr-0.5 text-amber-600" aria-label={t('rowPending')}>●</span> : null}
                            B {fmt.format(row.booking.price)}
                            {row.booking.typed ? '✎' : ''}
                            <span className="text-muted-foreground"> / {fmt.format(row.booking.minGuest)}</span>
                          </>
                        ) : (
                          'B —'
                        )}
                      </span>
                      <span className="hidden text-rose-700 dark:text-rose-300 sm:block" title={t('rowAirbnbTitle')}>
                        A {row.airbnb != null ? fmt.format(row.airbnb) : '—'}
                        {row.airbnbTyped ? '✎' : ''}
                      </span>
                    </span>
                  ) : (
                  <span className="mt-auto flex flex-wrap items-baseline justify-end gap-x-1 text-right tabular-nums">
                    {n?.minStay ? <span className="mr-auto text-[10px] text-muted-foreground">{t('minStayShort', { n: n.minStay })}</span> : null}
                    {n?.kind === 'open' && n.prices ? (
                      <>
                        {deal && n.rack != null ? (
                          <s className="hidden text-[10px] text-muted-foreground sm:inline">{fmt.format(n.rack)}</s>
                        ) : null}
                        <span className={cn('text-xs font-semibold sm:text-sm', deal && 'text-emerald-700 dark:text-emerald-400')}>
                          {fmt.format(n.prices.regular)}
                        </span>
                      </>
                    ) : n?.rack != null ? (
                      <span className="text-[10px] text-muted-foreground sm:text-[11px]">{fmt.format(n.rack)}</span>
                    ) : null}
                  </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
