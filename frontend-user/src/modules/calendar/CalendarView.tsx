'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { Epg, Layout, useEpg } from 'planby';
import type { Channel } from 'planby';
import { addDays, eachDayOfInterval, format, startOfDay } from 'date-fns';
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
import { useZodomusCalendarSync } from './hooks/useZodomusCalendarSync';
import { getPropertyMeta } from './lib/property-meta';
import { ProgramBlock } from './components/ProgramBlock';
import { TimelineHeader } from './components/TimelineHeader';
import { SidebarChannel } from './components/SidebarChannel';
import { CalendarSkeleton } from './components/CalendarSkeleton';
import { CalendarEmptyNoProperties, CalendarEmptyNoReservations } from './components/CalendarEmpty';
import { CalendarError } from './components/CalendarError';
import { FilterBar } from './components/FilterBar';
import { TimelineNavBar } from './components/TimelineNavBar';
import { NewBookingSheet } from './components/NewBookingSheet';
import { ReservationDetailPanel, ReservationDetailPanelFooter } from './components/ReservationDetailPanel';
import { getCalendarPlanbyTheme } from './lib/planby-app-theme';
import { parseLocalCalendarDay } from './lib/calendar-api-dates';

const ITEM_HEIGHT_PX = 64;

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
  const zodomusSync = useZodomusCalendarSync(1);

  const properties = data?.properties ?? [];
  const reservations = data?.reservations ?? [];
  const { filteredProperties, filteredReservations } = useCalendarFilters(properties, reservations, filters);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => {
    if (!selectedId) return null;
    return filteredReservations.find((r) => r.uuid === selectedId) ?? null;
  }, [filteredReservations, selectedId]);

  useEffect(() => {
    if (selectedId && !filteredReservations.some((r) => r.uuid === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, filteredReservations]);
  const [newBookingOpen, setNewBookingOpen] = useState(false);
  /** Row clicked on grid → preselect property in «Новая бронь» (null = first object). */
  const [newBookingPropertyId, setNewBookingPropertyId] = useState<string | null>(null);
  /** Column clicked on grid → check-in / check-out for that day (null = today/tomorrow from toolbar). */
  const [newBookingGridDates, setNewBookingGridDates] = useState<{
    checkIn: string;
    checkOut: string;
  } | null>(null);

  const numDays = useMemo(
    () => eachDayOfInterval({ start: startOfDay(dateRange.start), end: startOfDay(dateRange.end) }).length,
    [dateRange],
  );
  const dayWidthPx = (isMobile ? 48 : 60) * numDays;

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
        since: format(parseLocalCalendarDay(r.checkIn), "yyyy-MM-dd'T'HH:mm:ss"),
        till: format(parseLocalCalendarDay(r.checkOut), "yyyy-MM-dd'T'HH:mm:ss"),
        _reservation: r,
      })),
    [filteredReservations],
  );

  const { getEpgProps, getLayoutProps } = useEpg({
    channels,
    epg,
    startDate: format(startOfDay(dateRange.start), "yyyy-MM-dd'T'00:00:00"),
    /** Planby span = hours between start and this instant; use day after last visible day (same idea as calendar API `to` + 1). */
    endDate: format(addDays(startOfDay(dateRange.end), 1), "yyyy-MM-dd'T'00:00:00"),
    dayWidth: dayWidthPx,
    sidebarWidth: isMobile ? 56 : 240,
    itemHeight: ITEM_HEIGHT_PX,
    isLine: false,
    isTimeline: true,
    isSidebar: true,
    theme: planbyTheme,
  });

  const epgProps = getEpgProps();
  const layoutProps = getLayoutProps();
  const { hourWidth: layoutHourWidth, itemHeight: layoutItemHeight, ref: planbyScrollRef } = layoutProps;
  const dayColWidthPx = 24 * layoutHourWidth;

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
      const rect = content.getBoundingClientRect();
      const y = e.clientY - rect.top + el.scrollTop;
      const rowIndex = Math.floor(Math.max(0, y) / ITEM_HEIGHT_PX);
      const prop = filteredProperties[rowIndex];
      setNewBookingPropertyId(prop?.uuid ?? null);
      const x = e.clientX - rect.left + el.scrollLeft;
      const w = dayColWidthPx > 0 ? dayColWidthPx : 1;
      const dayIndex =
        numDays > 0 ? Math.min(numDays - 1, Math.max(0, Math.floor(x / w))) : 0;
      const rangeStart = startOfDay(dateRange.start);
      setNewBookingGridDates({
        checkIn: format(addDays(rangeStart, dayIndex), 'yyyy-MM-dd'),
        checkOut: format(addDays(rangeStart, dayIndex + 1), 'yyyy-MM-dd'),
      });
      setNewBookingOpen(true);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [planbyScrollRef, filteredProperties, dayColWidthPx, numDays, dateRange.start]);

  const onSelectReservation = useCallback((r: Reservation) => setSelectedId(r.uuid), []);

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

  const renderChannel = useCallback(
    ({ channel }: { channel: Channel }) => {
      const { top, height } = channel.position;
      return (
        <div
          key={channel.uuid}
          data-testid="sidebar-item"
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
            meta={getPropertyMeta(channel.uuid, filteredReservations, dateRange)}
            isMobile={isMobile}
          />
        </div>
      );
    },
    [filteredReservations, dateRange, isMobile],
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
}
.dark #cal-${calendarScopeId} .planby [data-testid="sidebar"] {
  background-color: var(--card) !important;
}
/* Высоту/позицию строк задаёт renderChannel (как ChannelBox Planby); фон подстраховываем под сетку */
#cal-${calendarScopeId} .planby [data-testid="sidebar-item"] {
  box-sizing: border-box;
}
/* Не добавлять border на sidebar-item: Planby задаёт ровно itemHeight px; лишний border ломает стык с горизонталями контента */
#cal-${calendarScopeId} .planby[data-testid="container"] > div:first-child > div:first-child {
  display: none !important;
}
#cal-${calendarScopeId} .planby [data-testid="content"] {
  cursor: crosshair;
}
#cal-${calendarScopeId} .planby [data-testid="program-item"] {
  cursor: pointer;
}
#cal-${calendarScopeId} .planby {
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

  /** Кнопка синка показывается при любых объектах; без Zodomus id тост подскажет. */
  const showSyncOta = useMemo(() => properties.length > 0, [properties]);
  const showEmptyPeriodHint = reservations.length === 0 && properties.length > 0;
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
      <div className="flex flex-1 flex-col">
        <FilterBar
          filters={filters}
          onFiltersChange={onFiltersChange}
          properties={properties}
          reservations={reservations}
          filteredCount={filteredProperties.length}
          onNewBooking={openNewBooking}
          showSyncOta={showSyncOta}
          onSyncOta={onSyncOta}
          isSyncingOta={zodomusSync.isPending}
        />
        <CalendarError onRetry={() => refetch()} />
        <NewBookingSheet
          open={newBookingOpen}
          onOpenChange={onNewBookingSheetOpenChange}
          properties={properties}
          initialPropertyId={newBookingPropertyId}
          initialGridDates={newBookingGridDates}
        />
      </div>
    );
  }

  if (isPending && !data) {
    return (
      <div className="flex flex-1 flex-col">
        <FilterBar
          filters={filters}
          onFiltersChange={onFiltersChange}
          properties={properties}
          reservations={reservations}
          filteredCount={0}
          onNewBooking={openNewBooking}
          showSyncOta={showSyncOta}
          onSyncOta={onSyncOta}
          isSyncingOta={zodomusSync.isPending}
        />
        <CalendarSkeleton />
        <NewBookingSheet
          open={newBookingOpen}
          onOpenChange={onNewBookingSheetOpenChange}
          properties={properties}
          initialPropertyId={newBookingPropertyId}
          initialGridDates={newBookingGridDates}
        />
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div className="flex flex-1 flex-col">
        <FilterBar
          filters={filters}
          onFiltersChange={onFiltersChange}
          properties={[]}
          reservations={[]}
          filteredCount={0}
          onNewBooking={openNewBooking}
          showSyncOta={false}
        />
        <CalendarEmptyNoProperties />
        <NewBookingSheet
          open={newBookingOpen}
          onOpenChange={onNewBookingSheetOpenChange}
          properties={properties}
          initialPropertyId={newBookingPropertyId}
          initialGridDates={newBookingGridDates}
        />
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className="flex w-full min-w-0 max-w-full flex-col overflow-x-hidden">
      <FilterBar
        filters={filters}
        onFiltersChange={onFiltersChange}
        properties={properties}
        reservations={reservations}
        filteredCount={filteredProperties.length}
        onNewBooking={openNewBooking}
        showSyncOta={showSyncOta}
        onSyncOta={onSyncOta}
        isSyncingOta={zodomusSync.isPending}
      />
      {showEmptyPeriodHint ? (
        <Alert className="mb-3 border-dashed">
          <AlertDescription className="space-y-1">
            <span className="block">{t('emptyPeriodHint')}</span>
            {showSyncOta ? (
              <span className="block text-muted-foreground">{t('emptyPeriodOtaHint')}</span>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {showFiltersEmptyHint ? (
        <Alert className="mb-3 border-dashed" variant="default">
          <AlertDescription>{t('emptyFiltersHint')}</AlertDescription>
        </Alert>
      ) : null}
      <TimelineNavBar
        dateRange={dateRange}
        onDateRangeChange={onDateRangeChange}
        isFetching={isFetching}
        isLoading={isLoading}
      />

      <div
        id={`cal-${calendarScopeId}`}
        className="relative w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-card shadow-sm"
      >
        {filteredProperties.length === 0 ? (
          <CalendarEmptyNoReservations />
        ) : (
          <>
            {/* eslint-disable-next-line react/no-danger -- scoped grid overlay for Planby content */}
            <style dangerouslySetInnerHTML={{ __html: calendarGridCss }} />
            <div className="w-full min-w-0">
              <Epg {...epgProps}>
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

      <ResponsiveModal open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        {selected && (
          <ResponsiveModalContent
            title={selected.guestName}
            footer={<ReservationDetailPanelFooter reservation={selected} />}
          >
            <ReservationDetailPanel reservation={selected} onCopy={() => toast.success(t('copied'))} />
          </ResponsiveModalContent>
        )}
      </ResponsiveModal>

      <NewBookingSheet
        open={newBookingOpen}
        onOpenChange={onNewBookingSheetOpenChange}
        properties={properties}
        initialPropertyId={newBookingPropertyId}
        initialGridDates={newBookingGridDates}
      />
    </div>
    </TooltipProvider>
  );
}
