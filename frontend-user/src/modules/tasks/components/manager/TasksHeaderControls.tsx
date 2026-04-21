'use client';

import { useCallback, useState } from 'react';
import { CalendarRange, Kanban, LayoutList, ListFilter, Search } from 'lucide-react';
import { addDays, format } from 'date-fns';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useTasksFiltersStore } from '@/stores/tasks-filters.store';
import { useTasksViewMode } from '../../hooks/useTasksViewMode';
import {
  tasksToolbarIconButtonActive,
  tasksToolbarIconButtonBase,
  tasksToolbarIconButtonIdle,
} from '../../task-toolbar-icon-button-classes';
import { isTasksListSliceFiltered, TasksStatusPriorityFilterPanel } from './TasksStatusPriorityFilterPanel';

export type TasksHeaderControlsLayout = 'default' | 'headerRow' | 'headerDesktopGrid';

const WIDE = {
  start: new Date('2000-01-01T12:00:00'),
  end: new Date('2100-12-31T12:00:00'),
};

const datePillInput =
  'h-7 w-[7.25rem] shrink-0 cursor-pointer rounded-full border border-border/60 bg-muted/30 px-2 py-0 text-[10px] font-medium text-foreground shadow-none [color-scheme:dark] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-[7.5rem]';

export function TasksHeaderControls({
  layout = 'default',
  desktopPageTitle,
}: {
  layout?: TasksHeaderControlsLayout;
  /** Для `headerDesktopGrid`: заголовок по центру строки (как раньше в шапке). */
  desktopPageTitle?: string;
}) {
  const t = useTranslations('tasks');
  const { view, setView } = useTasksViewMode();
  const filters = useTasksFiltersStore((s) => s.filters);
  const setFilters = useTasksFiltersStore((s) => s.setFilters);

  const [searchOpen, setSearchOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);
  const [listFiltersOpen, setListFiltersOpen] = useState(false);

  const propertyQuery = filters.propertyQuery;
  const fromStr = format(filters.dateRange.start, 'yyyy-MM-dd');
  const toStr = format(filters.dateRange.end, 'yyyy-MM-dd');

  const toggleSearch = useCallback(() => {
    setDatesOpen(false);
    setListFiltersOpen(false);
    setSearchOpen((v) => !v);
  }, []);

  const toggleDates = useCallback(() => {
    setSearchOpen(false);
    setListFiltersOpen(false);
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
  const listSliceFiltered = isTasksListSliceFiltered(filters);

  const isHeaderRow = layout === 'headerRow';
  const isHeaderDesktopGrid = layout === 'headerDesktopGrid';
  const compactHeaderTop = isHeaderRow || isHeaderDesktopGrid;

  const viewModeToolbar = (
    <div
      className={cn(
        'flex h-9 min-w-0 shrink-0 items-center gap-0.5 rounded-xl border border-border bg-card p-0.5 shadow-sm ring-1 ring-border/40',
        'dark:bg-card/80 dark:ring-border/30',
      )}
      role="toolbar"
      aria-label={t('viewModes.toolbarAria')}
    >
      {(
        [
          { id: 'list' as const, icon: LayoutList },
          { id: 'kanban' as const, icon: Kanban },
        ] as const
      ).map(({ id, icon: Icon }) => (
        <Button
          key={id}
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            'h-8 gap-0.5 rounded-lg px-1.5 sm:px-2',
            view === id
              ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground dark:shadow-[0_0_16px_-4px_rgba(0,180,200,0.35)]'
              : 'text-muted-foreground hover:bg-muted/80 dark:hover:bg-muted/40',
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
  );

  const iconToolbar = (
    <div className="flex h-9 shrink-0 items-center gap-1.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          tasksToolbarIconButtonBase,
          searchActive ? tasksToolbarIconButtonActive : tasksToolbarIconButtonIdle,
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
          tasksToolbarIconButtonBase,
          datesActive ? tasksToolbarIconButtonActive : tasksToolbarIconButtonIdle,
        )}
        aria-label={t('filters.periodAria')}
        aria-expanded={datesOpen}
        aria-pressed={datesOpen}
        onClick={toggleDates}
      >
        <CalendarRange className="h-4 w-4" aria-hidden />
      </Button>
      <DropdownMenu
        open={listFiltersOpen}
        onOpenChange={(open) => {
          setListFiltersOpen(open);
          if (open) {
            setSearchOpen(false);
            setDatesOpen(false);
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              tasksToolbarIconButtonBase,
              'relative',
              listFiltersOpen ? tasksToolbarIconButtonActive : tasksToolbarIconButtonIdle,
            )}
            aria-label={t('filters.listFilterToggleAria')}
            aria-expanded={listFiltersOpen}
          >
            <ListFilter className="h-4 w-4" aria-hidden />
            {listSliceFiltered ? (
              <span
                className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-background"
                aria-hidden
              />
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[min(20rem,calc(100vw-2rem))] p-3">
          <TasksStatusPriorityFilterPanel />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1 sm:gap-1.5',
        compactHeaderTop ? 'px-0 py-0' : 'px-3 py-1 sm:px-4 sm:py-2',
      )}
    >
      {isHeaderDesktopGrid ? (
        <div className="relative flex min-h-11 w-full min-w-0 items-center justify-between gap-3 px-4 pt-3 pb-2 sm:min-h-12 sm:pt-4 sm:pb-2.5">
          <div className="z-20 flex shrink-0 items-center justify-start">{viewModeToolbar}</div>
          <div className="z-20 flex shrink-0 items-center justify-end">{iconToolbar}</div>
          <h1
            className="pointer-events-none absolute left-1/2 top-1/2 z-10 max-w-[min(16rem,calc(100%-11rem))] -translate-x-1/2 -translate-y-1/2 truncate text-center text-lg font-semibold tracking-tight text-foreground"
          >
            {desktopPageTitle ?? t('pageTitle')}
          </h1>
        </div>
      ) : (
        <div className="flex min-h-9 w-full min-w-0 items-center">
          {viewModeToolbar}
          {/* Разрыв между режимами просмотра и поиском/датами — не склеивать в одну «полосу» */}
          <div className="min-w-2 flex-1" aria-hidden />
          {iconToolbar}
        </div>
      )}

      {searchOpen ? (
        <div
          className={cn(
            'relative min-w-0',
            compactHeaderTop && 'border-t border-border/40 px-4 pb-1 pt-2 sm:pb-1.5 sm:pt-2.5',
          )}
        >
          <Search
            className={cn(
              'pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground',
              compactHeaderTop ? 'left-6' : 'left-2',
            )}
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
        <div
          className={cn(
            'flex flex-wrap items-center gap-1.5',
            compactHeaderTop && 'border-t border-border/40 px-4 pb-2 pt-2 sm:pb-2.5 sm:pt-2.5',
          )}
        >
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
