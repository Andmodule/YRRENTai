'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { format, startOfDay } from 'date-fns';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Percent, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import { CalendarPlanbyGrid, type CalendarPricingProps } from './components/CalendarPlanbyGrid';
import { getCalendarPlanbyTheme } from './lib/planby-app-theme';
import { parseLocalCalendarDay } from './lib/calendar-api-dates';
import { isBookingIdPinQuery, normalizeCalendarQuery, reservationMatchesQuery } from './calendarSearch';
import { useCalendarPromotions, usePricingAccess, usePricingProperties } from '@/modules/pricing/hooks';
import { PromotionFormSheet, type PromotionFormInitial } from '@/modules/pricing/components/PromotionFormSheet';
import { CalendarPromotionDialog } from '@/modules/pricing/components/calendar/CalendarPromotionDialog';
import type { CellRect } from '@/modules/pricing/components/calendar/CalendarPromotionsLayer';
import { useStayRangeFormatter } from '@/modules/pricing/components/shared';
import { addDaysYmd, localYmd, promotionsForCell } from '@/modules/pricing/lib/pricing-ui';

const PRICING_HINT_KEY = 'rentai.pricing.calendarHintHidden';

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

  // «Цены → Скидки» in the calendar: badges, range selection, discount sheet (owners / managers, feature on).
  const tp = useTranslations('pricing.calendar');
  const fmtStayRange = useStayRangeFormatter();
  const pricingOn = usePricingAccess().enabled;
  const firstDayYmd = format(startOfDay(dateRange.start), 'yyyy-MM-dd');
  const lastDayYmd = format(startOfDay(dateRange.end), 'yyyy-MM-dd');
  const calendarPromotions = useCalendarPromotions(firstDayYmd, lastDayYmd, pricingOn);
  const [selection, setSelection] = useState<CellRect | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountInitial, setDiscountInitial] = useState<PromotionFormInitial | null>(null);
  const [promoCell, setPromoCell] = useState<{ propertyId: string; ymd: string } | null>(null);
  const [promoCellOpen, setPromoCellOpen] = useState(false);
  const pricingRows = usePricingProperties(pricingOn && (selection != null || promoCellOpen));

  const visibleIdsKey = useMemo(() => filteredProperties.map((p) => p.uuid).join(','), [filteredProperties]);
  useEffect(() => {
    setSelection(null);
  }, [firstDayYmd, lastDayYmd, visibleIdsKey]);

  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelection(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection]);

  const selectionInfo = useMemo(() => {
    if (!selection) return null;
    const rows = filteredProperties.slice(selection.r1, selection.r2 + 1);
    const pricingById = new Map((pricingRows.data ?? []).map((r) => [r.id, r]));
    const bookingIds = rows
      .filter((p) => {
        const row = pricingById.get(p.uuid);
        return row ? row.bookingConnected : Boolean(p.zodomusLinked || p.zodomusPropertyId?.trim());
      })
      .map((p) => p.uuid);
    const from = addDaysYmd(firstDayYmd, selection.d1);
    const to = addDaysYmd(firstDayYmd, selection.d2);
    return {
      bookingIds,
      skipped: rows.length - bookingIds.length,
      from,
      to,
      nights: selection.d2 - selection.d1 + 1,
      past: to < localYmd(),
    };
  }, [selection, filteredProperties, pricingRows.data, firstDayYmd]);

  const openDiscount = useCallback((initial: PromotionFormInitial) => {
    setDiscountInitial(initial);
    setDiscountOpen(true);
  }, []);

  const onDiscountOpenChange = useCallback((o: boolean) => {
    setDiscountOpen(o);
    if (!o) setSelection(null);
  }, []);

  const onBadgeClick = useCallback((propertyId: string, ymd: string) => {
    setPromoCell({ propertyId, ymd });
    setPromoCellOpen(true);
  }, []);

  const promoCellView = useMemo(() => {
    if (!promoCell) return null;
    const prop = properties.find((p) => p.uuid === promoCell.propertyId);
    return {
      ...promoCell,
      title: prop?.title ?? '',
      promotions: promotionsForCell(calendarPromotions.data ?? [], promoCell.propertyId, promoCell.ymd),
      rackPrice: prop?.otaNightlyPrices?.[promoCell.ymd] ?? null,
      currency: prop?.otaCurrency ?? prop?.currency ?? null,
      geniusPct: pricingRows.data?.find((r) => r.id === promoCell.propertyId)?.geniusPct ?? null,
    };
  }, [promoCell, properties, calendarPromotions.data, pricingRows.data]);

  const gridPricing = useMemo<CalendarPricingProps | undefined>(
    () =>
      pricingOn
        ? {
            promotions: calendarPromotions.data ?? [],
            selection,
            onSelectionChange: setSelection,
            onBadgeClick,
          }
        : undefined,
    [pricingOn, calendarPromotions.data, selection, onBadgeClick],
  );

  /** One-time hint about the drag selection; hiding it is a per-browser convenience. */
  const [pricingHintHidden, setPricingHintHidden] = useState(true);
  useEffect(() => {
    try {
      setPricingHintHidden(window.localStorage.getItem(PRICING_HINT_KEY) === '1');
    } catch {
      setPricingHintHidden(false);
    }
  }, []);
  const hidePricingHint = useCallback(() => {
    setPricingHintHidden(true);
    try {
      window.localStorage.setItem(PRICING_HINT_KEY, '1');
    } catch {
      // storage unavailable — the hint just comes back next time
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
        onSetDiscount={
          pricingOn && newBookingPropertyId && newBookingGridDates
            ? () =>
                openDiscount({
                  propertyIds: [newBookingPropertyId],
                  stayFrom: newBookingGridDates.checkIn,
                  stayTo: newBookingGridDates.checkIn,
                })
            : undefined
        }
      />
      {pricingOn ? (
        <>
          <PromotionFormSheet open={discountOpen} onOpenChange={onDiscountOpenChange} initial={discountInitial} />
          {promoCellView ? (
            <CalendarPromotionDialog
              open={promoCellOpen}
              onOpenChange={setPromoCellOpen}
              propertyId={promoCellView.propertyId}
              propertyTitle={promoCellView.title}
              ymd={promoCellView.ymd}
              promotions={promoCellView.promotions}
              rackPrice={promoCellView.rackPrice}
              currency={promoCellView.currency}
              geniusPct={promoCellView.geniusPct}
            />
          ) : null}
        </>
      ) : null}
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
          onNewDiscount={pricingOn ? () => openDiscount({ preset: 'week' }) : undefined}
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
        {pricingOn && !isMobile && !pricingHintHidden ? (
          <div className="flex items-center gap-2 border-t border-dashed border-border/60 px-4 py-1 text-xs text-muted-foreground">
            <span
              className="shrink-0 rounded-md bg-emerald-600 px-1.5 text-[11px] font-bold leading-[18px] text-white"
              aria-hidden
            >
              −10%
            </span>
            <span className="min-w-0 flex-1">{tp('hint')}</span>
            <button
              type="button"
              onClick={hidePricingHint}
              aria-label={tp('hintClose')}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ) : null}
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
            pricing={gridPricing}
          />
        )}
        {pricingOn && selectionInfo ? (
          <div
            role="region"
            aria-label={tp('selectionAria')}
            className="absolute bottom-4 left-1/2 z-20 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-zinc-900 py-2.5 pl-4 pr-2.5 text-sm text-white shadow-2xl dark:bg-zinc-800"
          >
            <span className="font-semibold">
              {tp('selection', {
                count: selectionInfo.bookingIds.length,
                range: fmtStayRange(selectionInfo.from, selectionInfo.to),
                nights: selectionInfo.nights,
              })}
            </span>
            {selectionInfo.past ? (
              <span className="text-[13px] text-amber-300">{tp('selectionPast')}</span>
            ) : selectionInfo.skipped > 0 ? (
              <span className="text-[13px] text-zinc-300">{tp('selectionSkip', { count: selectionInfo.skipped })}</span>
            ) : null}
            <Button
              type="button"
              size="sm"
              className="h-10 gap-2 bg-blue-600 px-3.5 text-white hover:bg-blue-500"
              disabled={selectionInfo.past || selectionInfo.bookingIds.length === 0}
              onClick={() =>
                openDiscount({
                  propertyIds: selectionInfo.bookingIds,
                  stayFrom: selectionInfo.from,
                  stayTo: selectionInfo.to,
                })
              }
            >
              <Percent className="h-4 w-4" aria-hidden />
              {tp('discountSelected')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-10 border border-zinc-700 px-3 text-white hover:bg-zinc-800 hover:text-white dark:hover:bg-zinc-700"
              onClick={() => setSelection(null)}
            >
              {tp('reset')}
            </Button>
          </div>
        ) : null}
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
              displayCurrencyFallback={
                selectedProperty?.otaCurrency ?? selectedProperty?.currency
              }
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
