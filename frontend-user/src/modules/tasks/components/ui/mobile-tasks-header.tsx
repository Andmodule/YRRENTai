'use client';

import { useCallback, useEffect, useState } from 'react';
import { addDays, format } from 'date-fns';
import {
  ArrowLeft,
  CalendarRange,
  Kanban,
  LayoutList,
  ListFilter,
  Menu,
  MoreVertical,
  Search,
  X,
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as RadixDialog from '@radix-ui/react-dialog';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useTasksFiltersStore } from '@/stores/tasks-filters.store';
import { useUiStore } from '@/stores/ui.store';
import { useTasksViewMode } from '../../hooks/useTasksViewMode';
import {
  isTasksListSliceFiltered,
  TasksStatusPriorityFilterPanel,
} from '../manager/TasksStatusPriorityFilterPanel';

const WIDE = {
  start: new Date('2000-01-01T12:00:00'),
  end: new Date('2100-12-31T12:00:00'),
} as const;

const dateInputClass =
  'h-9 w-full min-w-0 cursor-pointer rounded-lg border border-border/60 bg-muted/30 px-2 py-1 text-xs font-medium text-foreground shadow-none [color-scheme:dark] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export type MobileTasksHeaderMode = 'default' | 'search' | 'date';

export type MobileTasksViewMode = 'list' | 'kanban';

interface MobileTasksHeaderProps {
  title: string;
}

export function MobileTasksHeader({ title }: MobileTasksHeaderProps) {
  const t = useTranslations('tasks');
  const { toggleSidebar } = useUiStore();
  const filters = useTasksFiltersStore((s) => s.filters);
  const setFilters = useTasksFiltersStore((s) => s.setFilters);
  const { view, setView } = useTasksViewMode();

  const [mode, setMode] = useState<MobileTasksHeaderMode>('default');
  const [searchQuery, setSearchQuery] = useState(filters.propertyQuery);
  const [viewSheetOpen, setViewSheetOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const fromStr = format(filters.dateRange.start, 'yyyy-MM-dd');
  const toStr = format(filters.dateRange.end, 'yyyy-MM-dd');

  const enableRangeFromFrom = useCallback(
    (v: string) => {
      if (!v) return;
      const start = new Date(`${v}T12:00:00`);
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
    },
    [setFilters],
  );

  const enableRangeFromTo = useCallback(
    (v: string) => {
      if (!v) return;
      const endDay = new Date(`${v}T12:00:00`);
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
    },
    [setFilters],
  );

  const clearDateRange = useCallback(() => {
    setFilters((prev) => ({
      ...prev,
      dateRangeEnabled: false,
      dateRange: { start: WIDE.start, end: WIDE.end },
    }));
  }, [setFilters]);

  const syncSearchToStore = useCallback(
    (q: string) => {
      setFilters((prev) => ({ ...prev, propertyQuery: q }));
    },
    [setFilters],
  );

  const openSearchMode = useCallback(() => {
    setSearchQuery(filters.propertyQuery);
    setMode('search');
  }, [filters.propertyQuery]);

  const closeToDefault = useCallback(() => {
    setMode('default');
  }, []);

  const mobileView: MobileTasksViewMode = view === 'kanban' ? 'kanban' : 'list';
  const listSliceFiltered = isTasksListSliceFiltered(filters);

  const pickView = useCallback(
    (next: MobileTasksViewMode) => {
      setView(next);
      setViewSheetOpen(false);
    },
    [setView],
  );

  /** Тот же принцип, что у `Header` / staff: сплошной фон токенов, без glass и без tasks-theme на всей полосе */
  const mobileHeaderBar = 'w-full bg-background/95 backdrop-blur-sm dark:bg-background/90';

  if (mode === 'search') {
    return (
      <header
        className={cn(
          mobileHeaderBar,
          'flex h-14 items-center gap-1 px-3 pt-[max(0.25rem,env(safe-area-inset-top))] transition-all duration-200 animate-in fade-in slide-in-from-top-1',
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0 text-muted-foreground"
          onClick={closeToDefault}
          aria-label={t('mobileHeader.backAria')}
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Button>
        <input
          autoFocus
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          placeholder={t('filters.propertyPlaceholder')}
          className="min-w-0 flex-1 bg-transparent py-2 text-base text-foreground outline-none placeholder:text-muted-foreground"
          value={searchQuery}
          onChange={(e) => {
            const v = e.target.value;
            setSearchQuery(v);
            syncSearchToStore(v);
          }}
        />
        {searchQuery ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 text-muted-foreground"
            onClick={() => {
              setSearchQuery('');
              syncSearchToStore('');
            }}
            aria-label={t('mobileHeader.clearSearchAria')}
          >
            <X className="h-5 w-5" aria-hidden />
          </Button>
        ) : null}
      </header>
    );
  }

  if (mode === 'date') {
    return (
      <header
        className={cn(
          mobileHeaderBar,
          'flex min-h-14 flex-col gap-2 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] transition-all duration-200 animate-in fade-in slide-in-from-top-1',
        )}
      >
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 text-muted-foreground"
            onClick={closeToDefault}
            aria-label={t('mobileHeader.backAria')}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Button>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {t('filters.periodSheetTitle')}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 pb-1 pl-1">
          <label className="flex min-w-[8.5rem] flex-1 flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase text-muted-foreground">{t('filters.from')}</span>
            <Input
              type="date"
              value={filters.dateRangeEnabled ? fromStr : ''}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                enableRangeFromFrom(v);
              }}
              className={dateInputClass}
              aria-label={t('filters.from')}
            />
          </label>
          <label className="flex min-w-[8.5rem] flex-1 flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase text-muted-foreground">{t('filters.to')}</span>
            <Input
              type="date"
              value={filters.dateRangeEnabled ? toStr : ''}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                enableRangeFromTo(v);
              }}
              className={dateInputClass}
              aria-label={t('filters.to')}
            />
          </label>
          {filters.dateRangeEnabled ? (
            <Button type="button" variant="outline" size="sm" className="shrink-0 text-xs" onClick={clearDateRange}>
              {t('filters.periodClear')}
            </Button>
          ) : null}
        </div>
      </header>
    );
  }

  return (
    <>
      <header
        className={cn(
          mobileHeaderBar,
          'relative flex h-14 items-center gap-2 px-3 pt-[max(0.25rem,env(safe-area-inset-top))] transition-colors duration-200',
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative z-10 h-10 w-10 shrink-0 text-muted-foreground"
          onClick={toggleSidebar}
          aria-label={t('mobileHeader.menuAria')}
        >
          <Menu className="h-6 w-6" aria-hidden />
        </Button>
        <h1 className="pointer-events-none absolute left-1/2 top-1/2 z-0 max-w-[min(16rem,calc(100%-7rem))] -translate-x-1/2 -translate-y-1/2 truncate text-center text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h1>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="relative z-10 ml-auto h-10 w-10 shrink-0 text-muted-foreground"
              aria-label={t('mobileHeader.kebabAria')}
            >
              <MoreVertical className="h-6 w-6" aria-hidden />
              {listSliceFiltered ? (
                <span
                  className="absolute right-1 top-1 h-2 w-2 rounded-full bg-destructive ring-2 ring-background"
                  aria-hidden
                />
              ) : null}
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              sideOffset={6}
              align="end"
              className="z-[200] min-w-[13rem] overflow-hidden rounded-xl border border-border/60 bg-popover p-1 text-popover-foreground shadow-lg"
            >
              <DropdownMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm outline-none data-[highlighted]:bg-accent"
                onSelect={() => {
                  openSearchMode();
                }}
              >
                <Search className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                {t('mobileHeader.menuSearch')}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm outline-none data-[highlighted]:bg-accent"
                onSelect={() => setMode('date')}
              >
                <CalendarRange className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                {t('mobileHeader.menuDateRange')}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="relative flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm outline-none data-[highlighted]:bg-accent"
                onSelect={() => setFilterSheetOpen(true)}
              >
                <ListFilter className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                {t('mobileHeader.menuListFilters')}
                {listSliceFiltered ? (
                  <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-destructive" aria-hidden />
                ) : null}
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm outline-none data-[highlighted]:bg-accent"
                onSelect={() => setViewSheetOpen(true)}
              >
                <Kanban className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                {t('mobileHeader.menuView')}: {mobileView === 'list' ? t('viewModes.list') : t('viewModes.kanban')}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>

      <RadixDialog.Root open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-[100] bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <RadixDialog.Content
            className={cn(
              'tasks-theme fixed inset-x-0 bottom-0 z-[101] max-h-[85dvh] rounded-t-2xl border border-border/60 bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl outline-none',
              'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-bottom-2 data-[state=open]:slide-in-from-bottom-4',
            )}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <RadixDialog.Title className="sr-only">{t('filters.listFilterSheetTitle')}</RadixDialog.Title>
            <RadixDialog.Description className="sr-only">{t('filters.listFilterSheetDescription')}</RadixDialog.Description>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted" aria-hidden />
            <p className="mb-3 text-center text-base font-semibold text-foreground">{t('filters.listFilterSheetTitle')}</p>
            <TasksStatusPriorityFilterPanel />
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      <RadixDialog.Root open={viewSheetOpen} onOpenChange={setViewSheetOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-[100] bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <RadixDialog.Content
            className={cn(
              'tasks-theme fixed inset-x-0 bottom-0 z-[101] max-h-[85dvh] rounded-t-2xl border border-border/60 bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl outline-none',
              'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-bottom-2 data-[state=open]:slide-in-from-bottom-4',
            )}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <RadixDialog.Title className="sr-only">{t('mobileHeader.viewSheetTitle')}</RadixDialog.Title>
            <RadixDialog.Description className="sr-only">{t('viewModes.hint')}</RadixDialog.Description>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted" aria-hidden />
            <p className="mb-3 text-center text-base font-semibold text-foreground">{t('mobileHeader.viewSheetTitle')}</p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => pickView('list')}
                className={cn(
                  'flex items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors',
                  mobileView === 'list'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/60 bg-muted/20 text-foreground hover:bg-muted/40',
                )}
              >
                <span className="flex items-center gap-3">
                  <LayoutList className="h-5 w-5 shrink-0" aria-hidden />
                  {t('viewModes.list')}
                </span>
                {mobileView === 'list' ? (
                  <span className="text-primary" aria-hidden>
                    ✓
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => pickView('kanban')}
                className={cn(
                  'flex items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors',
                  mobileView === 'kanban'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/60 bg-muted/20 text-foreground hover:bg-muted/40',
                )}
              >
                <span className="flex items-center gap-3">
                  <Kanban className="h-5 w-5 shrink-0" aria-hidden />
                  {t('viewModes.kanban')}
                </span>
                {mobileView === 'kanban' ? (
                  <span className="text-primary" aria-hidden>
                    ✓
                  </span>
                ) : null}
              </button>
            </div>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
    </>
  );
}
