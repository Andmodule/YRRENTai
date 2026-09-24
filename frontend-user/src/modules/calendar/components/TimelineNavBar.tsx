'use client';

import { useState } from 'react';
import { addDays, format, isWithinInterval, startOfDay, subDays } from 'date-fns';
import { useTranslations } from 'next-intl';
import { CalendarDays, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { CalendarDateRange } from '../types';
import { useDateLocale } from '@/hooks/useDateLocale';

/** Arrow step: one week. */
const STEP_DAYS = 7;
/** Visible window length in calendar days (inclusive). */
export const CALENDAR_WINDOW_DAYS = 14;
/** Days before the anchor (today / jump date) included in the window. */
export const CALENDAR_WINDOW_PAST_DAYS = 1;

export function buildCalendarWindowAround(anchor: Date): CalendarDateRange {
  const day = startOfDay(anchor);
  return {
    start: subDays(day, CALENDAR_WINDOW_PAST_DAYS),
    end: addDays(day, CALENDAR_WINDOW_DAYS - CALENDAR_WINDOW_PAST_DAYS - 1),
  };
}

interface TimelineNavBarProps {
  dateRange: CalendarDateRange;
  onDateRangeChange: (r: CalendarDateRange) => void;
  isFetching: boolean;
  isLoading: boolean;
}

export function TimelineNavBar({
  dateRange,
  onDateRangeChange,
  isFetching,
  isLoading,
}: TimelineNavBarProps) {
  const t = useTranslations('calendar');
  const locale = useDateLocale();
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpDate, setJumpDate] = useState(() => format(startOfDay(new Date()), 'yyyy-MM-dd'));

  const todayInRange = isWithinInterval(startOfDay(new Date()), {
    start: startOfDay(dateRange.start),
    end: startOfDay(dateRange.end),
  });
  const showTodayBtn = !todayInRange;

  /** Block week arrows / jump while calendar (Zodomus-paced overlay) is in flight. */
  const navLocked = isFetching || isLoading;
  const showFetchBar = isFetching && !isLoading;

  const goBack = () => {
    if (navLocked) return;
    onDateRangeChange({
      start: addDays(dateRange.start, -STEP_DAYS),
      end: addDays(dateRange.end, -STEP_DAYS),
    });
  };

  const goForward = () => {
    if (navLocked) return;
    onDateRangeChange({
      start: addDays(dateRange.start, STEP_DAYS),
      end: addDays(dateRange.end, STEP_DAYS),
    });
  };

  const goToday = () => {
    if (navLocked) return;
    onDateRangeChange(buildCalendarWindowAround(new Date()));
  };

  const applyJump = () => {
    if (navLocked || !jumpDate) return;
    const [y, m, d] = jumpDate.split('-').map(Number);
    if (!y || !m || !d) return;
    onDateRangeChange(buildCalendarWindowAround(new Date(y, m - 1, d)));
    setJumpOpen(false);
  };

  const windowLabel = t('navWindowLabel', {
    start: format(dateRange.start, 'd MMM', { locale }),
    end: format(dateRange.end, 'd MMM yyyy', { locale }),
  });

  return (
    <div className="relative bg-card">
      {showFetchBar && (
        <div
          className="pointer-events-none fixed left-0 right-0 top-0 z-[100] h-0.5 overflow-hidden bg-blue-500/20"
          aria-live="polite"
          aria-label={t('loadingAria')}
        >
          <div className="h-full w-full animate-pulse bg-blue-500" />
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-border/60 px-4 py-1.5 sm:py-2">
        <Button
          variant="outline"
          size="sm"
          type="button"
          aria-label={t('navPrev')}
          title={navLocked ? t('navWaitingChannel') : t('navWeekStep')}
          disabled={navLocked}
          onClick={goBack}
        >
          ←
        </Button>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-1 sm:flex-row sm:justify-center sm:gap-2">
          <DropdownMenu
            open={jumpOpen}
            onOpenChange={(open) => {
              if (navLocked && open) return;
              setJumpOpen(open);
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={navLocked}
                className="h-auto min-h-8 max-w-full flex-col gap-0.5 px-2 py-1 sm:flex-row sm:gap-1.5"
                aria-label={t('navJumpTitle')}
                title={navLocked ? t('navWaitingChannel') : undefined}
              >
                {navLocked ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                ) : (
                  <CalendarDays className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block" aria-hidden />
                )}
                <span className="truncate text-sm font-medium text-foreground">{windowLabel}</span>
                <span className="text-[10px] font-normal text-muted-foreground">
                  {navLocked ? t('navWaitingChannel') : t('navWeekHint')}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-64 p-3">
              <p className="mb-2 text-xs font-medium text-foreground">{t('navJumpTitle')}</p>
              <div className="space-y-1.5">
                <Label htmlFor="cal-jump-date" className="text-xs text-muted-foreground">
                  {t('navJumpDate')}
                </Label>
                <Input
                  id="cal-jump-date"
                  type="date"
                  className="h-9 text-sm"
                  value={jumpDate}
                  onChange={(e) => setJumpDate(e.target.value)}
                />
              </div>
              <Button type="button" size="sm" className="mt-3 w-full" disabled={navLocked} onClick={applyJump}>
                {t('navJumpApply')}
              </Button>
            </DropdownMenuContent>
          </DropdownMenu>
          {showTodayBtn && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              type="button"
              disabled={navLocked}
              title={navLocked ? t('navWaitingChannel') : undefined}
              onClick={goToday}
            >
              {t('today')}
            </Button>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          type="button"
          aria-label={t('navNext')}
          title={navLocked ? t('navWaitingChannel') : t('navWeekStep')}
          disabled={navLocked}
          onClick={goForward}
        >
          →
        </Button>
      </div>
    </div>
  );
}
