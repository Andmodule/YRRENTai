'use client';

import { memo } from 'react';
import { eachDayOfInterval, format, isSaturday, isSunday, isToday, startOfDay } from 'date-fns';
import type { Locale } from 'date-fns';
import { cn } from '@/lib/utils';
import type { CalendarDateRange } from '../types';

interface TimelineHeaderProps {
  hourWidth: number;
  /** Total timeline width in px — must match Planby Content `dayWidth` so header scrolls with the grid in one ScrollBox */
  dayWidth: number;
  sidebarWidth: number;
  isSidebar: boolean;
  dateRange: CalendarDateRange;
  locale: Locale;
}

/**
 * Sticky date row inside Planby ScrollBox.
 * - `sticky top` keeps dates visible on vertical scroll.
 * - Left corner is `sticky left` with solid bg so day cells never slide over property names.
 */
export const TimelineHeader = memo(function TimelineHeader({
  hourWidth,
  dayWidth,
  sidebarWidth,
  isSidebar,
  dateRange,
  locale,
}: TimelineHeaderProps) {
  const start = startOfDay(dateRange.start);
  const end = startOfDay(dateRange.end);
  const days = eachDayOfInterval({ start, end });
  const dayColWidth = 24 * hourWidth;

  const rowWidth = (isSidebar ? sidebarWidth : 0) + dayWidth;

  return (
    <div
      data-testid="calendar-timeline-header"
      className="sticky top-0 z-[15] flex h-[60px] min-h-[60px] shrink-0 border-b border-border bg-card"
      style={{ width: rowWidth, minWidth: rowWidth }}
    >
      {isSidebar ? (
        <div
          data-testid="calendar-timeline-corner"
          className="sticky left-0 z-[20] box-border shrink-0 border-r border-border bg-card"
          style={{ width: sidebarWidth, minWidth: sidebarWidth }}
          aria-hidden
        />
      ) : null}
      <div
        className="relative z-[10] flex shrink-0 overflow-hidden bg-card"
        style={{ width: dayWidth, minWidth: dayWidth }}
      >
        {days.map((day) => {
          const weekend = isSaturday(day) || isSunday(day);
          const today = isToday(day);
          const past = day < startOfDay(new Date());
          return (
            <div
              key={day.getTime()}
              className={cn(
                'flex shrink-0 flex-col items-center justify-center border-r border-border bg-card py-2 text-center text-xs font-medium text-foreground',
                weekend && 'bg-gray-50 dark:bg-muted/40',
                today && 'border-l-2 border-l-primary bg-primary/10 dark:bg-primary/15',
                past && 'opacity-60',
              )}
              style={{ width: dayColWidth, minWidth: dayColWidth }}
            >
              <span>{format(day, 'EEE d', { locale })}</span>
              {today && <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
            </div>
          );
        })}
      </div>
    </div>
  );
});
