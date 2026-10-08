'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { CalendarPromotion } from '../../api';
import { addDaysYmd, cellKey, cellPriceLabels, isNotSent, promotionsForCell } from '../../lib/pricing-ui';

export type CellRect = { r1: number; r2: number; d1: number; d2: number };

export { cellKey };

/** Booking nightly prices to print in the cells (see `cellPriceLabels`). */
export type CalendarCellPrices = {
  /** propertyId → night (yyyy-MM-dd) → rack price in the channel currency. */
  byProperty: ReadonlyMap<string, Readonly<Record<string, number>>>;
  /** Nights with a booking or closed on the channel — the price is printed over the bar, dimmed. */
  busy: ReadonlySet<string>;
  /** Check-out days: a bar covers the left half of the cell, so only the final price fits. */
  halfBusy: ReadonlySet<string>;
};

/** Below this column width a struck-through rack price does not fit next to the guest price. */
const FULL_PRICE_MIN_COL_PX = 88;

const BADGE_TONE = {
  on: 'bg-emerald-600 text-white',
  pending: 'bg-sky-600 text-white',
  dry_run: 'border border-dashed border-violet-500 bg-violet-50 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200',
  /** Sent, but Booking does not list it yet. */
  unconfirmed: 'border border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  /** Saved in RentAI only — it is NOT on Booking. */
  not_sent: 'border border-dashed border-red-500 bg-red-50 text-red-800 line-through dark:bg-red-500/15 dark:text-red-200',
} as const;

/**
 * Overlay rendered INTO Planby's content pane (position: relative): nightly prices and discount badges
 * per cell, and the range selection. It sits under booking bars (Planby programs use z-index 5) —
 * except the prices of booked nights, which are printed over the bars and let every click through.
 */
export function CalendarPromotionsLayer({
  propertyIds,
  firstDay,
  numDays,
  dayColWidthPx,
  rowHeightPx,
  promotions,
  cellPrices,
  selection,
  onBadgeClick,
}: {
  propertyIds: string[];
  /** yyyy-MM-dd of the first column. */
  firstDay: string;
  numDays: number;
  dayColWidthPx: number;
  rowHeightPx: number;
  promotions: CalendarPromotion[];
  cellPrices?: CalendarCellPrices;
  selection: CellRect | null;
  onBadgeClick: (propertyId: string, ymd: string) => void;
}) {
  const t = useTranslations('pricing.calendar');
  const locale = useLocale();
  const fmt = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }), [locale]);

  const prices = useMemo(() => {
    if (!cellPrices || cellPrices.byProperty.size === 0 || dayColWidthPx <= 0) return [];
    return cellPriceLabels({
      propertyIds,
      firstDay,
      numDays,
      byProperty: cellPrices.byProperty,
      busy: cellPrices.busy,
      halfBusy: cellPrices.halfBusy,
      promotions,
      narrow: dayColWidthPx < FULL_PRICE_MIN_COL_PX,
    });
  }, [cellPrices, promotions, propertyIds, firstDay, numDays, dayColWidthPx]);
  const freePrices = useMemo(() => prices.filter((p) => !p.booked), [prices]);
  const bookedPrices = useMemo(() => prices.filter((p) => p.booked), [prices]);
  const priceBox = (p: { row: number; day: number }) => ({
    top: (p.row + 1) * rowHeightPx - 19,
    left: p.day * dayColWidthPx + 3,
    width: dayColWidthPx - 8,
  });

  const badges = useMemo(() => {
    if (promotions.length === 0 || dayColWidthPx <= 0) return [];
    const out: { key: string; row: number; day: number; propertyId: string; ymd: string; pct: number; tone: keyof typeof BADGE_TONE; title: string }[] = [];
    propertyIds.forEach((propertyId, row) => {
      for (let day = 0; day < numDays; day++) {
        const ymd = addDaysYmd(firstDay, day);
        const list = promotionsForCell(promotions, propertyId, ymd);
        const top = list[0];
        if (!top) continue;
        const tone: keyof typeof BADGE_TONE = isNotSent(top.state)
          ? 'not_sent'
          : top.state === 'on'
            ? top.confirmed
              ? 'on'
              : 'unconfirmed'
            : top.state === 'pending'
              ? 'pending'
              : 'dry_run';
        const names = list.map((p) => `−${p.discountPct}% ${p.name}`).join(' · ');
        out.push({
          key: `${propertyId}:${ymd}`,
          row,
          day,
          propertyId,
          ymd,
          pct: top.discountPct,
          tone,
          title: tone === 'not_sent' ? `${t('badgeNotSent')} · ${names}` : tone === 'unconfirmed' ? `${t('badgeUnconfirmed')} · ${names}` : names,
        });
      }
    });
    return out;
  }, [promotions, propertyIds, firstDay, numDays, dayColWidthPx, t]);

  return (
    <>
    {bookedPrices.length > 0 ? (
      <div className="pointer-events-none absolute inset-0" style={{ zIndex: 6 }} aria-hidden>
        {bookedPrices.map((p) => (
          <span
            key={`booked:${p.key}`}
            className="absolute overflow-hidden whitespace-nowrap text-right text-[11px] leading-4 tabular-nums text-foreground/55"
            style={priceBox(p)}
          >
            {fmt.format(p.price)}
          </span>
        ))}
      </div>
    ) : null}
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 2 }} aria-hidden={badges.length === 0 && prices.length === 0 && !selection}>
      {freePrices.map((p) => (
        <span
          key={`price:${p.key}`}
          className="absolute overflow-hidden whitespace-nowrap text-right text-[11px] leading-4 tabular-nums text-muted-foreground"
          style={priceBox(p)}
        >
          {p.rack != null && !p.compact ? <s className="mr-1 opacity-70">{fmt.format(p.rack)}</s> : null}
          <span className={p.rack != null ? 'font-semibold text-emerald-700 dark:text-emerald-400' : undefined}>{fmt.format(p.price)}</span>
        </span>
      ))}
      {badges.map((b) => (
        <button
          key={b.key}
          type="button"
          data-pricing-interactive=""
          title={b.title}
          aria-label={t('badgeAria', { pct: b.pct, date: b.ymd })}
          onClick={() => onBadgeClick(b.propertyId, b.ymd)}
          className={cn(
            'pointer-events-auto absolute rounded-md px-1.5 text-[11px] font-bold leading-[18px] shadow-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            BADGE_TONE[b.tone],
          )}
          style={{ top: b.row * rowHeightPx + 4, left: (b.day + 1) * dayColWidthPx - 46, width: 42 }}
        >
          −{b.pct}%
        </button>
      ))}
      {selection ? (
        <div
          className="absolute rounded-md border-2 border-primary bg-primary/10"
          style={{
            top: selection.r1 * rowHeightPx,
            left: selection.d1 * dayColWidthPx,
            width: (selection.d2 - selection.d1 + 1) * dayColWidthPx,
            height: (selection.r2 - selection.r1 + 1) * rowHeightPx,
          }}
        />
      ) : null}
    </div>
    </>
  );
}
