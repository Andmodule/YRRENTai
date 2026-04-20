'use client';

/**
 * Источник канала (Booking / Airbnb / …) в 2026‑подходе лучше не дублировать в каждой ячейке:
 * — тонкий «ноготь» цвета канала только снизу полосы брони (data-channel + CSS);
 * — или одна легенда в шапке календаря + фильтр по каналу;
 * — или подпись только в тултипе / в детальной карточке (как сейчас в tooltip).
 * В ячейке оставляем плотный ряд без текста канала, чтобы не ломать выравнивание при склейке сегментов.
 */

import { memo, useCallback, useMemo } from 'react';
import { useProgram } from 'planby';
import type { ProgramItem as PlanbyProgramRow } from 'planby/dist/Epg/helpers/types';
import { format } from 'date-fns';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { useDateLocale } from '@/hooks/useDateLocale';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { BookingStatus, Reservation } from '../types';
import { calendarTimelineCardClasses } from '../lib/calendar-status-styles';
import { parseLocalCalendarDay } from '../lib/calendar-api-dates';
import { countNights } from '../lib/property-meta';

const WIDE_NIGHTS_PX = 120;

const statusLabelKey: Record<BookingStatus, string> = {
  confirmed: 'statusConfirmed',
  pending: 'statusPending',
  cleaning: 'statusCleaning',
  blocked: 'statusBlocked',
  cancelled: 'statusCancelled',
};

/**
 * Полоска совпадает с Planby: since/till = полдень заезда / полдень выезда → 12h заезд : 24×(n−1)h ночи : 12h выезд.
 * Оттенки подобраны так, чтобы слева→направо яркость не «переворачивалась» между light/dark (слева темнее заезда, справа светлее выезда).
 */
function NightSegmentStrip({ nightCount, t }: { nightCount: number; t: (key: string) => string }) {
  const n = Math.max(1, nightCount);
  const growO = 12;
  const growG = 12;
  const growB = Math.max(0, 24 * n - 24);
  return (
    <div className="flex h-2.5 w-full shrink-0 overflow-hidden rounded-t-lg" aria-hidden>
      <div
        className="min-w-0 bg-teal-800 dark:bg-teal-700"
        style={{ flex: `${growO} 1 0%` }}
        title={t('timelineSegmentCheckin')}
      />
      {growB > 0 ? (
        <div
          className={cn('min-w-0 bg-sky-600 dark:bg-sky-700')}
          style={{ flex: `${growB} 1 0%` }}
          title={t('timelineSegmentStay')}
        />
      ) : null}
      <div
        className="min-w-0 bg-emerald-500 dark:bg-emerald-400"
        style={{ flex: `${growG} 1 0%` }}
        title={t('timelineSegmentCheckout')}
      />
    </div>
  );
}

interface ProgramBlockProps {
  program: {
    program: PlanbyProgramRow;
    isRTL: boolean;
    isBaseTimeFormat: boolean;
  };
  onSelect: (r: Reservation) => void;
  isMobile: boolean;
}

export const ProgramBlock = memo(function ProgramBlock({ program, onSelect, isMobile: _isMobile }: ProgramBlockProps) {
  const t = useTranslations('calendar');
  const locale = useDateLocale();
  const p = program.program;
  const {
    styles: layoutStyles,
    isMinWidth: _isMinWidth,
  } = useProgram({
    program: p,
    isRTL: program.isRTL,
    isBaseTimeFormat: program.isBaseTimeFormat,
    minWidth: 48,
  });

  const data = p.data as PlanbyProgramRow['data'] & { _reservation?: Reservation };
  const reservation = data._reservation;
  const status: BookingStatus = reservation?.status ?? 'pending';

  const blockWidth = layoutStyles.width;
  const showNights = blockWidth >= WIDE_NIGHTS_PX && reservation;
  const nights = reservation ? countNights(reservation.checkIn, reservation.checkOut) : 0;

  const tooltipText = useMemo(() => {
    if (!reservation) return '';
    const price = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: reservation.currency,
    }).format(reservation.totalPrice);
    const st = t(statusLabelKey[reservation.status]);
    const lines = [
      reservation.guestName,
      `${format(parseLocalCalendarDay(reservation.checkIn), 'd MMM', { locale })} → ${format(parseLocalCalendarDay(reservation.checkOut), 'd MMM yyyy', { locale })}`,
      st,
      price,
    ];
    if (reservation.fromOta) lines.push(t('otaSyncedTooltip'));
    if (status !== 'cancelled' && status !== 'blocked') {
      lines.push('', t('timelineLegendShort'));
    }
    return lines.join('\n');
  }, [reservation, locale, t, status]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (reservation) onSelect(reservation);
    },
    [onSelect, reservation],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        if (reservation) onSelect(reservation);
      }
    },
    [onSelect, reservation],
  );

  /** Отмена: тонкая полоска сверху слота — не перехватывает клик по сетке под собой. */
  if (status === 'cancelled' && reservation) {
    const ribbon = (
      <button
        type="button"
        data-testid="program-item"
        className="pointer-events-auto absolute left-0 top-0 z-[3] h-2.5 min-h-[10px] w-full max-w-full rounded-sm border border-border/60 bg-muted-foreground/35 outline-none transition-colors hover:bg-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background dark:bg-zinc-500/30 dark:hover:bg-zinc-500/45"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-label={tooltipText ? tooltipText.replace(/\n/g, ', ') : reservation.guestName}
      />
    );
    return (
      <div
        className="pointer-events-none absolute z-[2]"
        style={{ ...layoutStyles.position, width: layoutStyles.width }}
      >
        <Tooltip>
          <TooltipTrigger asChild>{ribbon}</TooltipTrigger>
          <TooltipContent side="top" className="max-w-sm whitespace-pre-line">
            {tooltipText}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  const blockInner = (
    <div
      className={cn(
        'box-border flex h-full min-h-[40px] w-full flex-col overflow-hidden rounded-lg border shadow-sm',
        calendarTimelineCardClasses[status],
      )}
      style={{ width: layoutStyles.width }}
    >
      {status === 'blocked' ? (
        <div
          className="h-2.5 w-full shrink-0 bg-zinc-950 dark:bg-black"
          title={t('timelineSegmentTechnical')}
          aria-hidden
        />
      ) : (
        <NightSegmentStrip nightCount={nights} t={t} />
      )}
      <button
        type="button"
        className={cn(
          'flex min-h-0 flex-1 items-center justify-end gap-1 rounded-b-lg px-1.5 py-0.5 text-left text-xs font-medium',
          'cursor-pointer transition-colors duration-200 hover:brightness-95 dark:hover:brightness-110',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-label={tooltipText ? tooltipText.replace(/\n/g, ', ') : 'booking'}
      >
        {showNights && reservation ? (
          <span className="shrink-0 text-[10px] font-normal text-muted-foreground">
            {nights} {t('nightsShort')}
          </span>
        ) : null}
      </button>
    </div>
  );

  return (
    <div
      className="pointer-events-auto absolute z-[2]"
      style={{ ...layoutStyles.position, width: layoutStyles.width }}
      data-testid="program-item"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
      }}
    >
      {reservation && tooltipText ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-full">{blockInner}</div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-sm whitespace-pre-line">
            {tooltipText}
          </TooltipContent>
        </Tooltip>
      ) : (
        blockInner
      )}
    </div>
  );
});
