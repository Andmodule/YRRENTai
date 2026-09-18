'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { Epg, Layout, useEpg } from 'planby';
import type { Channel } from 'planby';
import { addDays, addHours, eachDayOfInterval, format, startOfDay } from 'date-fns';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ResponsiveModal, ResponsiveModalContent } from '@/components/ui/responsive-modal';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDateLocale } from '@/hooks/useDateLocale';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { CalendarDateRange, CalendarFilters, Reservation } from './types';
import { useCalendarData } from './hooks/useCalendarData';
import { useCalendarFilters } from './hooks/useCalendarFilters';
import { useCalendarReservationSearch } from './hooks/useCalendarReservationSearch';
import { useZodomusCalendarSync } from './hooks/useZodomusCalendarSync';
import { useCalendarTimelinePan } from './hooks/use-calendar-timeline-pan';
import { useContainerSize } from './hooks/useContainerSize';
import { getPropertyMeta } from './lib/property-meta';
import { ProgramBlock } from './components/ProgramBlock';
import { TimelineHeader } from './components/TimelineHeader';
import { SidebarChannel } from './components/SidebarChannel';
import { CalendarSkeleton } from './components/CalendarSkeleton';
import { CalendarEmptyNoProperties, CalendarEmptyNoReservations } from './components/CalendarEmpty';
import { CalendarError } from './components/CalendarError';
import { FilterBar } from './components/FilterBar';
import { TimelineNavBar, buildCalendarWindowAround } from './components/TimelineNavBar';
import { SmartCreateSheet } from '@/modules/tasks/components/manager/SmartCreateSheet';
import { NewBookingSheet } from './components/NewBookingSheet';
import { SetOtaPriceSheet } from './components/SetOtaPriceSheet';
import { CalendarCellActionsDialog } from './components/CalendarCellActionsDialog';
import { ReservationDetailPanel, ReservationDetailPanelFooter } from './components/ReservationDetailPanel';
import { getCalendarPlanbyTheme } from './lib/planby-app-theme';
import { parseLocalCalendarDay } from './lib/calendar-api-dates';
import { hitTestCalendarCell } from './lib/hit-test-calendar-cell';
import { isBookingIdPinQuery, normalizeCalendarQuery, reservationMatchesQuery } from './calendarSearch';

const ITEM_HEIGHT_PX = 64;
const DAY_COLUMN_WIDTH_PX = {
  mobile: 64,
  desktop: 96,
} as const;

export interface CalendarViewProps {
  dateRange: CalendarDateRange;
  onDateRangeChange: (r: CalendarDateRange) => void;
  filters: CalendarFilters;
  onFiltersChange: (f: CalendarFilters) => void;
}

export function CalendarView({
  dateRange,
  onDateRangeChange,
  filters,
  onFiltersChange,
}: CalendarViewProps) {
  const t = useTranslations('calendar');
  const locale = useDateLocale();
  const isMobile = useIsMobile();
  const calendarScopeId = useId().replace(/:/g, '');
  const { resolvedTheme } = useTheme();
  const planbyTheme = useMemo(
    () => getCalendarPlanbyTheme(resolvedTheme === 'dark'),
    [resolvedTheme],
  );
  const { data, isLoading, isError, isFetching, refetch, isPending } = useCalendarData(dateRange);
  const reservationSearch = useCalendarReservationSearch(filters.propertyQuery);
  const globalSearchReservations = reservationSearch.data ?? [];
  const searchDebouncedQuery = reservationSearch.debouncedQuery;
  const zodomusSync = useZodomusCalendarSync(1);

  const properties = data?.properties ?? [];
  const reservations = data?.reservations ?? [];
  const reservationPoolForPin = useMemo(() => {
    const byId = new Map(reservations.map((r) => [r.uuid, r]));
    for (const r of globalSearchReservations) {
      byId.set(r.uuid, r);
    }
    return [...byId.values()];
  }, [reservations, globalSearchReservations]);

  const { filteredProperties, filteredReservations, reservationsForSearchIndex } = useCalendarFilters(
    properties,
    reservations,
    filters,
    globalSearchReservations,
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const lastAutopanKeyRef = useRef<string>('');
  useEffect(() => {
    const dq = searchDebouncedQuery.trim();
    const q = normalizeCalendarQuery(dq);
    if (q.length < 2) {
      lastAutopanKeyRef.current = '';
      return;
    }
    const candidates = reservationPoolForPin.filter((r) => reservationMatchesQuery(r, q));
    const key = `${q}::${candidates.map((c) => c.uuid).sort().join(',')}`;
    if (candidates.length !== 1) {
      lastAutopanKeyRef.current = '';
      return;
    }
    const hit = candidates[0]!;
    if (!isBookingIdPinQuery(dq, hit)) {
      lastAutopanKeyRef.current = '';
      return;
    }
    if (lastAutopanKeyRef.current === key) return;

    const checkIn = parseLocalCalendarDay(hit.checkIn);
    const ci = startOfDay(checkIn);
    const rs = startOfDay(dateRange.start);
    const re = startOfDay(dateRange.end);
    const inWindow = ci >= rs && ci <= re;
    if (!inWindow) {
      onDateRangeChange(buildCalendarWindowAround(checkIn));
    }
    setSelectedId(hit.uuid);
    lastAutopanKeyRef.current = key;
  }, [
    searchDebouncedQuery,
    reservationPoolForPin,
    onDateRangeChange,
    dateRange.start,
    dateRange.end,
  ]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return (
      filteredReservations.find((r) => r.uuid === selectedId) ??
      reservations.find((r) => r.uuid === selectedId) ??
      globalSearchReservations.find((r) => r.uuid === selectedId) ??
      null
    );
  }, [filteredReservations, selectedId, reservations, globalSearchReservations]);

  useEffect(() => {
    if (!selectedId) return;
    const exists =
      filteredReservations.some((r) => r.uuid === selectedId) ||
      reservations.some((r) => r.uuid === selectedId) ||
      globalSearchReservations.some((r) => r.uuid === selectedId);
    if (!exists) setSelectedId(null);
  }, [selectedId, filteredReservations, reservations, globalSearchReservations]);
  const [newBookingOpen, setNewBookingOpen] = useState(false);
  const [otaPriceOpen, setOtaPriceOpen] = useState(false);
  const [cellActionsOpen, setCellActionsOpen] = useState(false);
  /** Row clicked on grid → preselect property in «Новая бронь» (null = first object). */
  const [newBookingPropertyId, setNewBookingPropertyId] = useState<string | null>(null);
  const [cellActionPropertyTitle, setCellActionPropertyTitle] = useState<string | null>(null);
  const [cellActionDayLabel, setCellActionDayLabel] = useState<string | null>(null);
  /** Column clicked on grid → check-in / check-out for that day (null = today/tomorrow from toolbar). */
  const [newBookingGridDates, setNewBookingGridDates] = useState<{
    checkIn: string;
    checkOut: string;
  } | null>(null);
  /** Создание задачи из карточки брони — тот же SmartCreateSheet, что и «+» на доске задач. */
  const [taskCreateReservation, setTaskCreateReservation] = useState<Reservation | null>(null);

  const openTaskCreateFromBooking = useCallback((r: Reservation) => {
    setSelectedId(null);
    setTaskCreateReservation(r);
  }, []);

  const numDays = useMemo(
    () => eachDayOfInterval({ start: startOfDay(dateRange.start), end: startOfDay(dateRange.end) }).length,
    [dateRange],
  );
  const dayWidthPx = (isMobile ? DAY_COLUMN_WIDTH_PX.mobile : DAY_COLUMN_WIDTH_PX.desktop) * numDays;
  const { ref: gridContainerRef, width: gridWidth, height: gridHeight } = useContainerSize();

  const channels = useMemo(
    () =>
      filteredProperties.map((p) => ({
        uuid: p.uuid,
        logo: p.avatarUrl ?? '/icons/property-placeholder.svg',
        _property: p,
      })),
    [filteredProperties],
  );

  const epg = useMemo(
    () =>
      filteredReservations.map((r) => ({
        id: r.uuid,
        channelUuid: r.propertyId,
        title: r.guestName,
        description: '',
        image: '',
        /** Noon check-in → noon checkout: bar aligns with PM arrival and AM departure (not full midnight cells). */
        since: format(addHours(parseLocalCalendarDay(r.checkIn), 12), 'yyyy-MM-dd HH:mm:ss'),
        till: format(addHours(parseLocalCalendarDay(r.checkOut), 12), 'yyyy-MM-dd HH:mm:ss'),
        _reservation: r,
      })),
    [filteredReservations],
  );

  /** Force Planby remount when reservation set changes — useEpg often keeps a stale layout after cache upsert. */
  const planbyLayoutKey = useMemo(
    () =>
      filteredReservations
        .map((r) => `${r.uuid}:${r.checkIn}:${r.checkOut}:${r.status}`)
        .sort()
        .join('|'),
    [filteredReservations],
  );

  const { getEpgProps, getLayoutProps } = useEpg({
    channels,
    epg,
    startDate: format(startOfDay(dateRange.start), 'yyyy-MM-dd 00:00:00'),
    /** Planby span = hours between start and this instant; use day after last visible day (same idea as calendar API `to` + 1). */
    endDate: format(addDays(startOfDay(dateRange.end), 1), 'yyyy-MM-dd 00:00:00'),
    dayWidth: dayWidthPx,
    sidebarWidth: isMobile ? 56 : 240,
    itemHeight: ITEM_HEIGHT_PX,
    isLine: false,
    isTimeline: true,
    isSidebar: true,
    theme: planbyTheme,
    ...(gridWidth != null && gridWidth > 0 ? { width: gridWidth } : {}),
    ...(gridHeight != null && gridHeight > 0 ? { height: gridHeight } : {}),
  });

  const epgProps = getEpgProps();
  const layoutProps = getLayoutProps();
  const {
    hourWidth: layoutHourWidth,
    itemHeight: layoutItemHeight,
    ref: planbyScrollRef,
  } = layoutProps;
  const dayColWidthPx = 24 * layoutHourWidth;

  const timelinePanEnabled = Boolean(
    data &&
      !isError &&
      properties.length > 0 &&
      filteredProperties.length > 0 &&
      dayColWidthPx > 0,
  );

  useCalendarTimelinePan({
    enabled: timelinePanEnabled,
    scrollRef: planbyScrollRef,
    dayColWidthPx,
    numDays,
    dateRange,
    onDateRangeChange,
  });

  useEffect(() => {
    if (filteredProperties.length === 0) return;
    const el = planbyScrollRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-testid="program-item"]')) return;
      if (t.closest('[data-testid="sidebar"]')) return;
      if (t.closest('[data-testid="sidebar-item"]')) return;
      if (t.closest('[data-testid="calendar-timeline-header"]')) return;
      const content = t.closest('[data-testid="content"]') as HTMLElement | null;
      if (!content) return;
      if (dayColWidthPx <= 0 || numDays <= 0) return;

      const contentRect = content.getBoundingClientRect();
      /**
       * Content-relative coords from getBoundingClientRect already include scroll.
       * Adding scrollLeft/scrollTop double-counts and shifts day/row (e.g. 3.11 → 11.11).
       * Timeline header is a sibling above content → headerHeightPx = 0.
       */
      const yInContent = e.clientY - contentRect.top;
      const xInContent = e.clientX - contentRect.left;
      const rowHeight = layoutItemHeight > 0 ? layoutItemHeight : ITEM_HEIGHT_PX;

      const hit = hitTestCalendarCell({
        yInContent,
        xInContent,
        headerHeightPx: 0,
        itemHeightPx: rowHeight,
        dayColWidthPx,
        numDays,
        numRows: filteredProperties.length,
      });
      if (hit.kind !== 'cell') return;

      /** Prefer Planby sidebar row under the same client Y when present. */
      let propertyId: string | null = null;
      const sidebarItems = el.querySelectorAll('[data-testid="sidebar-item"]');
      for (let i = 0; i < sidebarItems.length; i++) {
        const item = sidebarItems[i];
        if (!(item instanceof HTMLElement)) continue;
        const rect = item.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY < rect.bottom) {
          propertyId = item.getAttribute('data-property-id');
          break;
        }
      }
      if (!propertyId) {
        propertyId = filteredProperties[hit.rowIndex]?.uuid ?? null;
      }
      if (!propertyId) return;

      const rangeStart = startOfDay(dateRange.start);
      const checkIn = format(addDays(rangeStart, hit.dayIndex), 'yyyy-MM-dd');
      const checkOut = format(addDays(rangeStart, hit.dayIndex + 1), 'yyyy-MM-dd');
      const prop = filteredProperties.find((p) => p.uuid === propertyId);
      const linked = Boolean(prop?.zodomusLinked || prop?.zodomusPropertyId?.trim());

      setNewBookingPropertyId(propertyId);
      setNewBookingGridDates({ checkIn, checkOut });

      if (linked) {
        setCellActionPropertyTitle(prop?.title ?? null);
        setCellActionDayLabel(checkIn);
        setCellActionsOpen(true);
        return;
      }

      setNewBookingOpen(true);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [
    planbyScrollRef,
    filteredProperties,
    dayColWidthPx,
    numDays,
    dateRange.start,
    layoutItemHeight,
  ]);

  const onSelectReservation = useCallback((r: Reservation) => {
    if (r.otaInventoryBlock) return;
    setSelectedId(r.uuid);
  }, []);

  const renderProgram = useCallback(
    (props: {
      program: import('planby/dist/Epg/helpers/types').ProgramItem;
      isRTL: boolean;
      isBaseTimeFormat: boolean;
    }) => (
      <ProgramBlock
        key={String(props.program.data.id)}
        program={props}
        onSelect={onSelectReservation}
        isMobile={isMobile}
      />
    ),
    [onSelectReservation, isMobile],
  );

  const propertyMetaById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of filteredProperties) {
      map.set(p.uuid, getPropertyMeta(p.uuid, filteredReservations, dateRange));
    }
    return map;
  }, [filteredProperties, filteredReservations, dateRange]);

  const renderChannel = useCallback(
    ({ channel }: { channel: Channel }) => {
      const { top, height } = channel.position;
      return (
        <div
          key={channel.uuid}
          data-testid="sidebar-item"
          data-property-id={channel.uuid}
          className="bg-[#f8fafc] dark:bg-card"
          style={{
            position: 'absolute',
            top,
            height,
            width: '100%',
            insetInlineStart: 0,
            display: 'flex',
            alignItems: 'center',
            boxSizing: 'border-box',
            overflow: 'hidden',
          }}
        >
          <SidebarChannel
            channel={channel}
            meta={propertyMetaById.get(channel.uuid) ?? ''}
            isMobile={isMobile}
          />
        </div>
      );
    },
    [propertyMetaById, isMobile],
  );

  const renderTimeline = useCallback(
    (props: {
      hourWidth: number;
      dayWidth: number;
      sidebarWidth: number;
      isSidebar: boolean;
    }) => (
      <TimelineHeader
        hourWidth={props.hourWidth}
        dayWidth={props.dayWidth}
        sidebarWidth={props.sidebarWidth}
        isSidebar={props.isSidebar}
        dateRange={dateRange}
        locale={locale}
      />
    ),
    [dateRange, locale],
  );

  const calendarGridCss = useMemo(
    () => {
      const rowH = layoutItemHeight;
      const colW = dayColWidthPx;
      return `
#cal-${calendarScopeId} .planby [data-testid="content"] {
  background-color: #f8fafc;
  background-image:
    repeating-linear-gradient(
      to right,
      transparent 0,
      transparent ${colW - 1}px,
      rgba(15, 23, 42, 0.07) ${colW - 1}px,
      rgba(15, 23, 42, 0.07) ${colW}px
    ),
    repeating-linear-gradient(
      to bottom,
      transparent 0,
      transparent ${rowH - 1}px,
      rgba(15, 23, 42, 0.06) ${rowH - 1}px,
      rgba(15, 23, 42, 0.06) ${rowH}px
    );
}
.dark #cal-${calendarScopeId} .planby [data-testid="content"] {
  background-color: var(--card);
  background-image:
    repeating-linear-gradient(
      to right,
      transparent 0,
      transparent ${colW - 1}px,
      rgba(148, 163, 184, 0.14) ${colW - 1}px,
      rgba(148, 163, 184, 0.14) ${colW}px
    ),
    repeating-linear-gradient(
      to bottom,
      transparent 0,
      transparent ${rowH - 1}px,
      rgba(148, 163, 184, 0.12) ${rowH - 1}px,
      rgba(148, 163, 184, 0.12) ${rowH}px
    );
}
#cal-${calendarScopeId} .planby [data-testid="sidebar"] {
  border-right: 1px solid var(--border);
  box-sizing: border-box;
  /* Above scrolling day cells; below timeline corner (z-20) */
  z-index: 18 !important;
}
.dark #cal-${calendarScopeId} .planby [data-testid="sidebar"] {
  background-color: var(--card) !important;
}
#cal-${calendarScopeId} .planby [data-testid="sidebar-item"] {
  box-sizing: border-box;
}
/* Не добавлять border на sidebar-item: Planby задаёт ровно itemHeight px; лишний border ломает стык с горизонталями контента */
/* Planby corner box unused — our TimelineHeader corner is sticky instead */
#cal-${calendarScopeId} .planby[data-testid="container"] > div:first-child > div:first-child {
  display: none !important;
}
#cal-${calendarScopeId} .planby [data-testid="calendar-timeline-header"] {
  isolation: isolate;
  /* Above program bars so sticky dates are never covered by row-0 ribbons */
  z-index: 15 !important;
}
#cal-${calendarScopeId} .planby [data-testid="content"] {
  cursor: crosshair;
  /* Keep programs under sticky header / sidebar */
  z-index: 1;
}
#cal-${calendarScopeId} .planby [data-testid="program-item"] {
  cursor: pointer;
  /* Must stay below sticky timeline header (z-15) and sidebar (z-18) */
  z-index: 5 !important;
}
#cal-${calendarScopeId} .planby {
  height: 100%;
  min-height: 0;
  scrollbar-width: thin;
  scrollbar-color: rgb(229 231 235) transparent;
}
.dark #cal-${calendarScopeId} .planby {
  scrollbar-color: rgb(51 65 85 / 0.6) transparent;
}
#cal-${calendarScopeId} .planby ::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
#cal-${calendarScopeId} .planby ::-webkit-scrollbar-thumb {
  background: rgb(229 231 235);
  border-radius: 9999px;
}
.dark #cal-${calendarScopeId} .planby ::-webkit-scrollbar-thumb {
  background: rgb(51 65 85 / 0.7);
}
`;
    },
    [calendarScopeId, dayColWidthPx, layoutItemHeight],
  );

  const openNewBooking = useCallback(() => {
    setNewBookingPropertyId(null);
    setNewBookingGridDates(null);
    setNewBookingOpen(true);
  }, []);

  const onNewBookingSheetOpenChange = useCallback((o: boolean) => {
    setNewBookingOpen(o);
    if (!o) {
      setNewBookingPropertyId(null);
      setNewBookingGridDates(null);
    }
  }, []);

  const onOtaPriceSheetOpenChange = useCallback((o: boolean) => {
    setOtaPriceOpen(o);
    if (!o) {
      setNewBookingPropertyId(null);
      setNewBookingGridDates(null);
    }
  }, []);

  const calendarSheets = (
    <>
      <CalendarCellActionsDialog
        open={cellActionsOpen}
        onOpenChange={setCellActionsOpen}
        propertyTitle={cellActionPropertyTitle ?? undefined}
        dayLabel={cellActionDayLabel ?? undefined}
        onNewBooking={() => setNewBookingOpen(true)}
        onSetOtaPrice={() => setOtaPriceOpen(true)}
      />
      <NewBookingSheet
        open={newBookingOpen}
        onOpenChange={onNewBookingSheetOpenChange}
        properties={properties}
        initialPropertyId={newBookingPropertyId}
        initialGridDates={newBookingGridDates}
      />
      <SetOtaPriceSheet
        open={otaPriceOpen}
        onOpenChange={onOtaPriceSheetOpenChange}
        properties={properties}
        initialPropertyId={newBookingPropertyId}
        initialGridDates={newBookingGridDates}
      />
    </>
  );
  /** Кнопка синка показывается при любых объектах; без Zodomus id тост подскажет. */
  const showSyncOta = useMemo(() => properties.length > 0, [properties]);
  const showFiltersEmptyHint =
    reservations.length > 0 && filteredReservations.length === 0 && properties.length > 0;

  const onSyncOta = useCallback((force?: boolean) => {
    zodomusSync.mutateAsync({ force: Boolean(force) }).then(
      (r) => {
        if (r.propertiesTouched === 0) {
          toast.message(t('syncOtaNoLinkedProperties'));
          return;
        }
        if (r.processed === 0 && r.skipped === 0 && r.failed === 0) {
          toast.message(t('syncOtaQueueEmpty'));
          return;
        }
        if (r.processed === 0 && r.skipped === 0 && r.failed > 0) {
          toast.error(t('syncOtaAllFailed', { failed: r.failed }));
          return;
        }
        if (r.processed === 0 && r.skipped > 0 && r.failed === 0) {
          toast.success(
            t('syncOtaAllSkipped', {
              skipped: r.skipped,
              properties: r.propertiesTouched,
            }),
          );
          return;
        }
        const msg = t('syncOtaSuccess', {
          processed: r.processed,
          skipped: r.skipped,
          failed: r.failed,
          properties: r.propertiesTouched,
        });
        const out = force ? `${msg} ${t('syncOtaForceSuffix')}` : msg;
        if (r.failed > 0) {
          toast.warning(out);
        } else {
          toast.success(out);
        }
      },
      (err: unknown) => {
        const data =
          err && typeof err === 'object' && 'response' in err
            ? (err as { response?: { status?: number; data?: { code?: string } } }).response?.data
            : undefined;
        if (data?.code === 'BACKEND_UNREACHABLE') {
          toast.error(t('syncOtaBackendDown'));
        } else {
          toast.error(t('syncOtaError'));
        }
      },
    );
  }, [zodomusSync, t]);

  if (isError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/90">
          <FilterBar
            filters={filters}
            onFiltersChange={onFiltersChange}
            properties={properties}
            reservations={reservationsForSearchIndex}
            onNewBooking={openNewBooking}
            showSyncOta={showSyncOta}
            onSyncOta={onSyncOta}
            isSyncingOta={zodomusSync.isPending}
            showBottomBorder={false}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <CalendarError onRetry={() => refetch()} />
        </div>
        {calendarSheets}
      </div>
    );
  }

  if (isPending && !data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/90">
          <FilterBar
            filters={filters}
            onFiltersChange={onFiltersChange}
            properties={properties}
            reservations={reservationsForSearchIndex}
            onNewBooking={openNewBooking}
            showSyncOta={showSyncOta}
            onSyncOta={onSyncOta}
            isSyncingOta={zodomusSync.isPending}
            showBottomBorder={false}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <CalendarSkeleton />
        </div>
        {calendarSheets}
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/90">
          <FilterBar
            filters={filters}
            onFiltersChange={onFiltersChange}
            properties={[]}
            reservations={[]}
            onNewBooking={openNewBooking}
            showSyncOta={false}
            showBottomBorder={false}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <CalendarEmptyNoProperties />
        </div>
        {calendarSheets}
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className="flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/90">
        <FilterBar
          filters={filters}
          onFiltersChange={onFiltersChange}
          properties={properties}
          reservations={reservationsForSearchIndex}
          onNewBooking={openNewBooking}
          showSyncOta={showSyncOta}
          onSyncOta={onSyncOta}
          isSyncingOta={zodomusSync.isPending}
          showBottomBorder={false}
        />
        {showFiltersEmptyHint ? (
          <Alert className="border-x-0 border-t border-dashed border-b-0 border-border/60 px-4 py-2" variant="default">
            <AlertDescription>{t('emptyFiltersHint')}</AlertDescription>
          </Alert>
        ) : null}
        <TimelineNavBar
          dateRange={dateRange}
          onDateRangeChange={onDateRangeChange}
          isFetching={isFetching}
          isLoading={isLoading}
        />
      </div>

      <div ref={gridContainerRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        id={`cal-${calendarScopeId}`}
        className="relative flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm"
      >
        {filteredProperties.length === 0 ? (
          <CalendarEmptyNoReservations />
        ) : (
          <>
            {/* eslint-disable-next-line react/no-danger -- scoped grid overlay for Planby content */}
            <style dangerouslySetInnerHTML={{ __html: calendarGridCss }} />
            <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
              <Epg key={planbyLayoutKey || 'empty'} {...epgProps}>
                <Layout
                  {...layoutProps}
                  renderProgram={renderProgram}
                  renderChannel={renderChannel}
                  renderTimeline={renderTimeline}
                />
              </Epg>
            </div>
          </>
        )}
      </div>
      </div>

      <ResponsiveModal
        open={!!selected}
        onOpenChange={(o) => !o && setSelectedId(null)}
        desktopPresentation="side"
      >
        {selected && (
          <ResponsiveModalContent
            title={selected.guestName}
            footer={
              <ReservationDetailPanelFooter
                reservation={selected}
                onCreateTask={openTaskCreateFromBooking}
                zodomusLinked={Boolean(
                  properties.find((p) => p.uuid === selected.propertyId)?.zodomusLinked ||
                    properties.find((p) => p.uuid === selected.propertyId)?.zodomusPropertyId?.trim(),
                )}
              />
            }
          >
            <ReservationDetailPanel reservation={selected} onCopy={() => toast.success(t('copied'))} />
          </ResponsiveModalContent>
        )}
      </ResponsiveModal>

      {calendarSheets}

      <div className="tasks-theme">
        <SmartCreateSheet
          open={!!taskCreateReservation}
          onOpenChange={(o) => {
            if (!o) setTaskCreateReservation(null);
          }}
          propertyId={taskCreateReservation?.propertyId ?? ''}
          bookingLink={
            taskCreateReservation
              ? {
                  reservationUuid: taskCreateReservation.uuid,
                  propertyId: taskCreateReservation.propertyId,
                  checkOut: taskCreateReservation.checkOut,
                }
              : null
          }
        />
      </div>
    </div>
    </TooltipProvider>
  );
}
