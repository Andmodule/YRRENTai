'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { CalendarPromotion } from '../../api';
import { addDaysYmd, isNotSent, promotionsForCell } from '../../lib/pricing-ui';

export type CellRect = { r1: number; r2: number; d1: number; d2: number };

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
 * Overlay rendered INTO Planby's content pane (position: relative): discount badges per cell and the
 * range selection. Badges sit under booking bars (Planby programs use z-index 5).
 */
export function CalendarPromotionsLayer({
  propertyIds,
  firstDay,
  numDays,
  dayColWidthPx,
  rowHeightPx,
  promotions,
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
  selection: CellRect | null;
  onBadgeClick: (propertyId: string, ymd: string) => void;
}) {
  const t = useTranslations('pricing.calendar');

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
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 2 }} aria-hidden={badges.length === 0 && !selection}>
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
  );
}
