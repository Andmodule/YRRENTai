'use client';

import { addDays, format, isWithinInterval, startOfDay } from 'date-fns';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CalendarDateRange } from '../types';
import { useDateLocale } from '@/hooks/useDateLocale';
const STEP_DAYS = 14;

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

  const todayInRange = isWithinInterval(startOfDay(new Date()), {
    start: startOfDay(dateRange.start),
    end: startOfDay(dateRange.end),
  });
  const showTodayBtn = !todayInRange;

  const showFetchBar = isFetching && !isLoading;

  const goBack = () =>
    onDateRangeChange({
      start: addDays(dateRange.start, -STEP_DAYS),
      end: addDays(dateRange.end, -STEP_DAYS),
    });

  const goForward = () =>
    onDateRangeChange({
      start: addDays(dateRange.start, STEP_DAYS),
      end: addDays(dateRange.end, STEP_DAYS),
    });

  const goToday = () => {
    const now = new Date();
    onDateRangeChange({
      start: addDays(now, -3),
      end: addDays(now, 18),
    });
  };

  const rangeLabel = `${format(dateRange.start, 'd MMM', { locale })} — ${format(dateRange.end, 'd MMM yyyy', { locale })}`;

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
        <Button variant="outline" size="sm" type="button" aria-label={t('navPrev')} onClick={goBack}>
          ←
        </Button>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-1 sm:flex-row sm:justify-center">
          <span className="text-center text-sm font-medium text-foreground">{rangeLabel}</span>
          {showTodayBtn && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" type="button" onClick={goToday}>
              {t('today')}
            </Button>
          )}
        </div>
        <Button variant="outline" size="sm" type="button" aria-label={t('navNext')} onClick={goForward}>
          →
        </Button>
      </div>
    </div>
  );
}
