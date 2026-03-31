'use client';

import { memo, useCallback, useMemo } from 'react';
import { useProgram } from 'planby';
import type { ProgramItem as PlanbyProgramRow } from 'planby/dist/Epg/helpers/types';
import { format, parseISO } from 'date-fns';
import { useTranslations } from 'next-intl';
import { Building2, Home, User, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDateLocale } from '@/hooks/useDateLocale';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { BookingChannel, BookingStatus, Reservation } from '../types';
import { calendarStatusClasses } from '../lib/calendar-status-styles';
import { countNights } from '../lib/property-meta';

const WIDE_NIGHTS_PX = 120;

const statusLabelKey: Record<BookingStatus, string> = {
  confirmed: 'statusConfirmed',
  pending: 'statusPending',
  cleaning: 'statusCleaning',
  blocked: 'statusBlocked',
};

function channelIcon(ch: BookingChannel) {
  const cls = 'h-3.5 w-3.5 shrink-0';
  switch (ch) {
    case 'booking':
      return <Building2 className={cls} aria-hidden />;
    case 'airbnb':
      return <Home className={cls} aria-hidden />;
    case 'direct':
      return <User className={cls} aria-hidden />;
    default:
      return <MoreHorizontal className={cls} aria-hidden />;
  }
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

export const ProgramBlock = memo(function ProgramBlock({ program, onSelect, isMobile }: ProgramBlockProps) {
  const t = useTranslations('calendar');
  const locale = useDateLocale();
  const p = program.program;
  const {
    styles: layoutStyles,
    isMinWidth,
  } = useProgram({
    program: p,
    isRTL: program.isRTL,
    isBaseTimeFormat: program.isBaseTimeFormat,
    minWidth: 48,
  });

  const data = p.data as PlanbyProgramRow['data'] & { _reservation?: Reservation };
  const reservation = data._reservation;
  const status = reservation?.status ?? 'pending';

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
      `${format(parseISO(reservation.checkIn), 'd MMM', { locale })} → ${format(parseISO(reservation.checkOut), 'd MMM yyyy', { locale })}`,
      st,
      price,
    ];
    if (reservation.fromOta) lines.push(t('otaSyncedTooltip'));
    return lines.join('\n');
  }, [reservation, locale, t]);

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

  const showGuest = !isMobile && isMinWidth;

  const blockInner = (
    <div
      className={cn(
        'box-border flex h-full min-h-[40px] w-full items-stretch rounded-r-lg border-l-[3px] shadow-sm transition-transform duration-200 hover:scale-[1.02]',
        calendarStatusClasses[status],
      )}
      style={{ width: layoutStyles.width }}
    >
      <button
        type="button"
        className={cn(
          'flex min-w-0 flex-1 items-center gap-1 rounded-r-lg px-1.5 py-1 text-left text-xs font-medium',
          'cursor-pointer transition-colors duration-200 hover:brightness-95 dark:hover:brightness-110',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <span className="shrink-0 text-current opacity-90">{channelIcon(reservation?.channel ?? 'direct')}</span>
        {showGuest && reservation && (
          <>
            <span className="min-w-0 flex-1 truncate">{reservation.guestName}</span>
            {showNights && (
              <span className="shrink-0 text-[10px] font-normal text-muted-foreground">
                {nights} {t('nightsShort')}
              </span>
            )}
          </>
        )}
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
