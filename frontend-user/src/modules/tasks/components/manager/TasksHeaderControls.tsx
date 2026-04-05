'use client';

import { useCallback, useState } from 'react';
import { CalendarRange, Kanban, LayoutList, Search, Table2 } from 'lucide-react';
import { addDays, format } from 'date-fns';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useTasksFiltersStore } from '@/stores/tasks-filters.store';
import { useTasksViewMode } from '../../hooks/useTasksViewMode';

const WIDE = {
  start: new Date('2000-01-01T12:00:00'),
  end: new Date('2100-12-31T12:00:00'),
};

const datePillInput =
  'h-7 w-[7.25rem] shrink-0 cursor-pointer rounded-full border border-border/60 bg-muted/30 px-2 py-0 text-[10px] font-medium text-foreground shadow-none [color-scheme:dark] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-[7.5rem]';

export function TasksHeaderControls() {
  const t = useTranslations('tasks');
  const { view, setView } = useTasksViewMode();
  const filters = useTasksFiltersStore((s) => s.filters);
  const setFilters = useTasksFiltersStore((s) => s.setFilters);

  const [searchOpen, setSearchOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);

  const propertyQuery = filters.propertyQuery;
  const fromStr = format(filters.dateRange.start, 'yyyy-MM-dd');
  const toStr = format(filters.dateRange.end, 'yyyy-MM-dd');

  const toggleSearch = useCallback(() => {
    setDatesOpen(false);
    setSearchOpen((v) => !v);
  }, []);

  const toggleDates = useCallback(() => {
    setSearchOpen(false);
    setDatesOpen((v) => !v);
  }, []);

  const enableRangeFromFrom = (v: string) => {
    if (!v) return;
    const start = new Date(v + 'T12:00:00');
    setFilters((prev) => {
      const end =
        prev.dateRangeEnabled && prev.dateRange.end.getTime() >= start.getTime()
          ? prev.dateRange.end
          : addDays(start, 30);
      const endD = new Date(end);
      endD.setHours(23, 59, 59, 999);
      return {
        ...prev,
        dateRangeEnabled: true,
        dateRange: { start, end: endD },
      };
    });
  };

  const enableRangeFromTo = (v: string) => {
    if (!v) return;
    const endDay = new Date(v + 'T12:00:00');
    const end = new Date(endDay);
    end.setHours(23, 59, 59, 999);
    setFilters((prev) => {
      const start =
        prev.dateRangeEnabled && prev.dateRange.start.getTime() <= end.getTime()
          ? prev.dateRange.start
          : addDays(endDay, -30);
      return {
        ...prev,
        dateRangeEnabled: true,
        dateRange: { start, end },
      };
    });
  };

  const searchActive = searchOpen || propertyQuery.trim().length > 0;
  const datesActive = datesOpen || filters.dateRangeEnabled;

  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-3 py-1.5 sm:px-4">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div
          className={cn(
            'flex min-w-0 shrink gap-0.5 rounded-xl border p-0.5 backdrop-blur-sm',
            'border-slate-200/90 bg-gradient-to-b from-white to-slate-100/55 shadow-sm ring-1 ring-slate-900/[0.04]',
            'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.95)]',
            'dark:border-slate-700/75 dark:from-slate-900/95 dark:to-slate-950/90 dark:ring-cyan-500/12',
            'dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_8px_28px_-16px_rgba(34,211,238,0.18)]',
          )}
          role="toolbar"
          aria-label={t('viewModes.toolbarAria')}
        >
          {(
            [
              { id: 'list' as const, icon: LayoutList },
              { id: 'kanban' as const, icon: Kanban },
              { id: 'table' as const, icon: Table2 },
            ] as const
          ).map(({ id, icon: Icon }) => (
            <Button
              key={id}
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 gap-0.5 rounded-md px-1.5 sm:h-8 sm:px-2',
                view === id
                  ? 'border-transparent bg-gradient-to-r from-cyan-600 to-violet-600 text-white shadow-sm hover:from-cyan-500 hover:to-violet-500 hover:text-white dark:shadow-[0_0_18px_-4px_rgba(34,211,238,0.45)]'
                  : 'text-muted-foreground hover:bg-slate-100/90 dark:hover:bg-slate-800/80',
              )}
              onClick={() => setView(id)}
              aria-pressed={view === id}
              aria-label={t(`viewModes.${id}`)}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="hidden text-[11px] font-medium sm:inline">{t(`viewModes.${id}`)}</span>
            </Button>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8 rounded-md border transition-colors',
              searchActive
                ? 'border-transparent bg-gradient-to-r from-cyan-600 to-violet-600 text-white shadow-sm hover:from-cyan-500 hover:to-violet-500 dark:shadow-[0_0_16px_-3px_rgba(34,211,238,0.4)]'
                : 'border-slate-200/90 bg-white/90 text-muted-foreground shadow-sm ring-1 ring-slate-900/[0.04] hover:bg-slate-50 dark:border-slate-600/55 dark:bg-slate-900/55 dark:ring-cyan-500/10 dark:hover:bg-slate-800/80',
            )}
            aria-label={t('filters.searchToggleAria')}
            aria-expanded={searchOpen}
            aria-pressed={searchOpen}
            onClick={toggleSearch}
          >
            <Search className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8 rounded-md border transition-colors',
              datesActive
                ? 'border-transparent bg-gradient-to-r from-cyan-600 to-violet-600 text-white shadow-sm hover:from-cyan-500 hover:to-violet-500 dark:shadow-[0_0_16px_-3px_rgba(34,211,238,0.4)]'
                : 'border-slate-200/90 bg-white/90 text-muted-foreground shadow-sm ring-1 ring-slate-900/[0.04] hover:bg-slate-50 dark:border-slate-600/55 dark:bg-slate-900/55 dark:ring-cyan-500/10 dark:hover:bg-slate-800/80',
            )}
            aria-label={t('filters.periodAria')}
            aria-expanded={datesOpen}
            aria-pressed={datesOpen}
            onClick={toggleDates}
          >
            <CalendarRange className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      {searchOpen ? (
        <div className="relative min-w-0">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={propertyQuery}
            onChange={(e) => setFilters((prev) => ({ ...prev, propertyQuery: e.target.value }))}
            placeholder={t('filters.propertyPlaceholder')}
            className="h-8 border-border/60 bg-muted/20 py-0 pl-8 pr-2 text-[11px]"
            aria-label={t('filters.property')}
            autoFocus
          />
        </div>
      ) : null}

      {datesOpen ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/20 pl-2 pr-1">
            <span className="text-[9px] font-medium uppercase text-muted-foreground">{t('filters.from')}</span>
            <Input
              type="date"
              value={filters.dateRangeEnabled ? fromStr : ''}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                enableRangeFromFrom(v);
              }}
              className={cn(datePillInput, 'border-0 bg-transparent')}
              aria-label={t('filters.from')}
            />
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/20 pl-2 pr-1">
            <span className="text-[9px] font-medium uppercase text-muted-foreground">{t('filters.to')}</span>
            <Input
              type="date"
              value={filters.dateRangeEnabled ? toStr : ''}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                enableRangeFromTo(v);
              }}
              className={cn(datePillInput, 'border-0 bg-transparent')}
              aria-label={t('filters.to')}
            />
          </span>
          {filters.dateRangeEnabled ? (
            <button
              type="button"
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  dateRangeEnabled: false,
                  dateRange: { start: WIDE.start, end: WIDE.end },
                }))
              }
              className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted/50"
            >
              {t('filters.periodClear')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
