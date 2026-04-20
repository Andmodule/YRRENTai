'use client';

import { memo, useCallback, useMemo } from 'react';
import { useProgram } from 'planby';
import type { ProgramItem as PlanbyProgramRow } from 'planby/dist/Epg/helpers/types';
import { format } from 'date-fns';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { useDateLocale } from '@/hooks/useDateLocale';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { BookingChannel, BookingStatus, Reservation } from '../types';
import { parseLocalCalendarDay } from '../lib/calendar-api-dates';
import { countNights } from '../lib/property-meta';

const statusLabelKey: Record<BookingStatus, string> = {
  confirmed: 'statusConfirmed',
  pending: 'statusPending',
  cleaning: 'statusCleaning',
  blocked: 'statusBlocked',
  cancelled: 'statusCancelled',
};

/** Канал: цвет левой кромки (как в плотных PMS — без текста в ячейке). */
const channelAccentLeft: Record<BookingChannel, string> = {
  booking: 'border-l-[3px] border-l-blue-600 dark:border-l-blue-400',
  airbnb: 'border-l-[3px] border-l-rose-500 dark:border-l-rose-400',
  direct: 'border-l-[3px] border-l-teal-600 dark:border-l-teal-400',
  other: 'border-l-[3px] border-l-violet-600 dark:border-l-violet-400',
};

const channelTooltipKey: Record<BookingChannel, string> = {
  booking: 'channelBooking',
  airbnb: 'channelAirbnb',
  direct: 'channelDirect',
  other: 'channelOther',
};

/**
 * PMS-style «occupancy ribbon»: одна цельная полоса со сплошной заливкой (без контурных «квадратов»).
 * Соотношение ширин 2:2:…:1 совпадает с Planby till = полдень дня выезда.
 */
function NightSegmentStrip({ nightCount, t }: { nightCount: number; t: (key: string) => string }) {
  const nights = Math.max(1, nightCount);
  const segments = nights + 1;
  return (
    <div
      className="flex h-3 w-full shrink-0 overflow-hidden bg-muted/50 dark:bg-muted/25"
      aria-hidden
    >
      {Array.from({ length: segments }, (_, i) => {
        const isLast = i === segments - 1;
        const flex = isLast ? '1 1 0%' : '2 1 0%';
        return (
          <div key={i} className="flex min-w-0 overflow-hidden" style={{ flex }}>
            {i === 0 ? (
              <>
                <div
                  className="h-full min-w-0 flex-1 bg-muted/60 dark:bg-muted/35"
                  title={t('timelineSegmentPreArrival')}
                />
                <div
                  className="h-full min-w-0 flex-1 bg-amber-400/75 dark:bg-amber-800/55"
                  title={t('timelineSegmentCheckin')}
                />
              </>
            ) : isLast ? (
              <>
                <div
                  className="h-full min-w-0 flex-1 bg-emerald-500/70 dark:bg-emerald-800/50"
                  title={t('timelineSegmentCheckout')}
                />
                <div
                  className="h-full min-w-0 flex-1 bg-muted/60 dark:bg-muted/35"
                  title={t('timelineSegmentPostCheckout')}
                />
              </>
            ) : (
              <div
                className="h-full w-full bg-sky-500/65 dark:bg-sky-800/50"
                title={t('timelineSegmentStay')}
              />
            )}
          </div>
        );
      })}
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

  const nights = reservation ? countNights(reservation.checkIn, reservation.checkOut) : 0;

  const tooltipText = useMemo(() => {
    if (!reservation) return '';
    const price = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: reservation.currency,
    }).format(reservation.totalPrice);
    const st = t(statusLabelKey[reservation.status]);
    const ch = t(channelTooltipKey[reservation.channel]);
    const lines = [
      reservation.guestName,
      `${format(parseLocalCalendarDay(reservation.checkIn), 'd MMM', { locale })} → ${format(parseLocalCalendarDay(reservation.checkOut), 'd MMM yyyy', { locale })}`,
      ch,
      st,
      price,
      `${nights} ${t('nights')}`,
    ];
    if (reservation.fromOta) lines.push(t('otaSyncedTooltip'));
    if (status !== 'cancelled' && status !== 'blocked') {
      lines.push('', t('timelineLegendShort'));
    }
    if (reservation.channel === 'other') lines.push('', t('channelOtherPlatformsHint'));
    return lines.join('\n');
  }, [reservation, locale, t, status, nights]);

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

  /** Отмена: узкая заливка, клик не блокирует сетку под собой. */
  if (status === 'cancelled' && reservation) {
    const ribbon = (
      <button
        type="button"
        data-testid="program-item"
        className="pointer-events-auto absolute left-0 top-0 z-[3] h-2.5 min-h-[10px] w-full max-w-full rounded-sm bg-muted-foreground/40 outline-none transition-colors hover:bg-muted-foreground/55 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background dark:bg-zinc-500/45 dark:hover:bg-zinc-500/60"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-label={tooltipText.replace(/\n/g, ', ')}
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

  const channel = reservation?.channel ?? 'direct';
  const cardShell = cn(
    'box-border flex h-full min-h-[40px] w-full flex-col overflow-hidden rounded-md border border-border/70 bg-card shadow-sm transition-colors dark:bg-card/85',
    'hover:brightness-[1.02] dark:hover:brightness-110',
    status !== 'blocked' && reservation && channelAccentLeft[channel],
    status === 'blocked' && 'border-l-[3px] border-l-zinc-900 bg-muted dark:border-l-zinc-200 dark:bg-zinc-950/80',
  );

  const blockInner = (
    <div className={cardShell} style={{ width: layoutStyles.width }}>
      {status === 'blocked' ? (
        <div
          className="h-3 w-full shrink-0 bg-zinc-900 dark:bg-zinc-950"
          title={t('timelineSegmentTechnical')}
          aria-hidden
        />
      ) : (
        <NightSegmentStrip nightCount={nights} t={t} />
      )}
      <button
        type="button"
        className={cn(
          'flex min-h-0 flex-1 cursor-pointer items-center justify-center rounded-none bg-muted/25 px-0 py-0 dark:bg-muted/15',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        )}
        aria-label={reservation ? tooltipText.replace(/\n/g, ', ') : undefined}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      />
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
