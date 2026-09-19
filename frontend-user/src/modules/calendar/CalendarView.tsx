'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { startOfDay } from 'date-fns';
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
import { useContainerSize } from './hooks/useContainerSize';
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
import { CalendarPlanbyGrid } from './components/CalendarPlanbyGrid';
import { getCalendarPlanbyTheme } from './lib/planby-app-theme';
import { parseLocalCalendarDay } from './lib/calendar-api-dates';
import { isBookingIdPinQuery, normalizeCalendarQuery, reservationMatchesQuery } from './calendarSearch';

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
  const [newBookingPropertyId, setNewBookingPropertyId] = useState<string | null>(null);
  const [cellActionPropertyTitle, setCellActionPropertyTitle] = useState<string | null>(null);
  const [cellActionDayLabel, setCellActionDayLabel] = useState<string | null>(null);
  const [newBookingGridDates, setNewBookingGridDates] = useState<{
    checkIn: string;
    checkOut: string;
  } | null>(null);
  const [taskCreateReservation, setTaskCreateReservation] = useState<Reservation | null>(null);

  const openTaskCreateFromBooking = useCallback((r: Reservation) => {
    setSelectedId(null);
    setTaskCreateReservation(r);
  }, []);

  const { ref: gridContainerRef, width: gridWidth, height: gridHeight } = useContainerSize();
  const hasMeasuredSize =
    gridWidth != null && gridWidth > 0 && gridHeight != null && gridHeight > 0;
  /**
   * Remount Planby once when container size first becomes valid so layoutHeight
   * is not stuck at 0. Do NOT key by pixel size — scrollbar changes remount-loop
   * the grid into a blank frame.
   */
  const [planbySizeEpoch, setPlanbySizeEpoch] = useState(0);
  const sizeReadyRef = useRef(false);
  useEffect(() => {
    if (!hasMeasuredSize || sizeReadyRef.current) return;
    sizeReadyRef.current = true;
    setPlanbySizeEpoch(1);
  }, [hasMeasuredSize]);

  const onSelectReservation = useCallback((r: Reservation) => {
    if (r.otaInventoryBlock) return;
    setSelectedId(r.uuid);
  }, []);

  const onEmptyCellClick = useCallback(
    (payload: {
      propertyId: string;
      propertyTitle: string | undefined;
      checkIn: string;
      checkOut: string;
      zodomusLinked: boolean;
    }) => {
      setNewBookingPropertyId(payload.propertyId);
      setNewBookingGridDates({ checkIn: payload.checkIn, checkOut: payload.checkOut });

      if (payload.zodomusLinked) {
        setCellActionPropertyTitle(payload.propertyTitle ?? null);
        setCellActionDayLabel(payload.checkIn);
        setCellActionsOpen(true);
        return;
      }

      setNewBookingOpen(true);
    },
    [],
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
  const showSyncOta = useMemo(() => properties.length > 0, [properties]);
  const showFiltersEmptyHint =
    reservations.length > 0 && filteredReservations.length === 0 && properties.length > 0;

  const timelinePanEnabled = Boolean(
    data && !isError && properties.length > 0 && filteredProperties.length > 0,
  );

  const selectedProperty = useMemo(
    () => (selected ? properties.find((p) => p.uuid === selected.propertyId) : undefined),
    [selected, properties],
  );

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
          <CalendarPlanbyGrid
            key={`epg-${planbySizeEpoch}`}
            calendarScopeId={calendarScopeId}
            dateRange={dateRange}
            onDateRangeChange={onDateRangeChange}
            filteredProperties={filteredProperties}
            filteredReservations={filteredReservations}
            width={hasMeasuredSize ? gridWidth : undefined}
            height={hasMeasuredSize ? gridHeight : undefined}
            isMobile={isMobile}
            locale={locale}
            planbyTheme={planbyTheme}
            timelinePanEnabled={timelinePanEnabled}
            onSelectReservation={onSelectReservation}
            onEmptyCellClick={onEmptyCellClick}
          />
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
                  selectedProperty?.zodomusLinked || selectedProperty?.zodomusPropertyId?.trim(),
                )}
              />
            }
          >
            <ReservationDetailPanel
              reservation={selected}
              onCopy={() => toast.success(t('copied'))}
              otaNightlyPrices={selectedProperty?.otaNightlyPrices}
              otaNightlyPricesFrom={selectedProperty?.otaNightlyPricesFrom}
            />
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
