'use client';

import { memo, useCallback } from 'react';
import { useProgram } from 'planby';
import type { ProgramItem as PlanbyProgramRow } from 'planby/dist/Epg/helpers/types';
import { Building2, Home, User, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BookingChannel, BookingStatus, Reservation } from '../types';

const statusStyles: Record<BookingStatus, string> = {
  confirmed: 'bg-blue-100 text-blue-700 border-blue-600/30',
  pending: 'bg-amber-100 text-amber-700 border-amber-600/30',
  cleaning: 'bg-rose-100 text-rose-700 border-rose-600/30',
  blocked: 'bg-gray-100 text-gray-500 border-gray-400/40',
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

  const handleClick = useCallback(() => {
    if (reservation) onSelect(reservation);
  }, [onSelect, reservation]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  const showGuest = !isMobile && isMinWidth;

  return (
    <div
      className="absolute z-[1]"
      style={{ ...layoutStyles.position, width: layoutStyles.width }}
      data-testid="program-item"
    >
      <div
        className={cn(
          'box-border flex h-full min-h-[40px] w-full items-stretch rounded-r-lg border-l-[3px] shadow-sm transition-transform duration-200 hover:scale-[1.02]',
          statusStyles[status],
        )}
        style={{ width: layoutStyles.width }}
      >
        <button
          type="button"
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1 rounded-r-lg px-1.5 py-1 text-left text-xs font-medium',
            'cursor-pointer transition-colors duration-200 hover:brightness-95',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1',
          )}
          role="button"
          tabIndex={0}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
        >
          <span className="shrink-0 text-current opacity-90">{channelIcon(reservation?.channel ?? 'direct')}</span>
          {showGuest && reservation && (
            <span className="min-w-0 truncate">{reservation.guestName}</span>
          )}
        </button>
      </div>
    </div>
  );
});
