'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ResponsiveModal, ResponsiveModalContent } from '@/components/ui/responsive-modal';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDateLocale } from '@/hooks/useDateLocale';
import { useProperties } from '@/hooks/use-properties';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { SmartCreateSheet } from '@/modules/tasks/components/manager/SmartCreateSheet';
import { useBasePrices, useCalendarPromotions, useGuestPrice, usePricingAccess, usePricingProperties } from '@/modules/pricing/hooks';
import { PromotionFormSheet, type PromotionFormInitial } from '@/modules/pricing/components/PromotionFormSheet';
import { CalendarPromotionDialog } from '@/modules/pricing/components/calendar/CalendarPromotionDialog';
import { addDaysYmd, localYmd, promotionsForCell, ymdToDate } from '@/modules/pricing/lib/pricing-ui';
import type { CalendarDateRange, Reservation } from '../types';
import { useCalendarData } from '../hooks/useCalendarData';
import { useCalendarDatesAccess } from '../calendar-dates-api';
import { CalendarError } from '../components/CalendarError';
import { CalendarDatesSheet } from '../components/CalendarDatesSheet';
import { NewBookingSheet } from '../components/NewBookingSheet';
import { SetOtaPriceSheet } from '../components/SetOtaPriceSheet';
import { ReservationDetailPanel, ReservationDetailPanelFooter } from '../components/ReservationDetailPanel';
import {
  buildMonthNights,
  monthBounds,
  monthOf,
  type NightSelection,
  nextSelection,
  parseMonth,
  rangeFromFields,
  shiftMonth,
  summarizeNights,
} from '../lib/property-month';
import { MonthGrid } from './MonthGrid';
import { NightPanel } from './NightPanel';
import { GuestPricePanel } from './GuestPricePanel';
import { BasePricePanel } from './BasePricePanel';
import { MobileNightSheet } from './MobileNightSheet';
import { useBookingSend } from './useBookingSend';
import { BookingSendStatus } from './BookingSendStatus';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import type { CellRows } from './MonthGrid';
import { airbnbGuestNight, airbnbLeadDeal, airbnbNightPrice, bookingCell, pickedStayBelowMin, discountedPrice } from '@/modules/pricing/lib/guest-price';
import { airbnbApi } from '@/modules/airbnb/api';
import { airbnbFromBooking, wholeAboveMin } from '../lib/airbnb-from-booking';

/** Calendar of one property by months (Airbnb-like): the month on the left, actions and prices on the right. */
export function PropertyMonthView({ propertyId }: { propertyId: string }) {
  const t = useTranslations('calendar.propertyMonth');
  const tc = useTranslations('calendar');
  const dateLocale = useDateLocale();
  const isMobile = useIsMobile();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const today = localYmd();
  const month = parseMonth(searchParams.get('month')) ?? monthOf(today);
  const setMonth = useCallback(
    (ym: string) => router.replace(`${pathname}?month=${ym}`, { scroll: false }),
    [router, pathname],
  );

  const { from, to } = monthBounds(month);
  const range = useMemo<CalendarDateRange>(() => ({ start: ymdToDate(from), end: ymdToDate(to) }), [from, to]);
  const { data, isPending, isFetching, isError, refetch } = useCalendarData(range, propertyId);
  // An older backend ignores `propertyId` and sends every property — pick ours either way.
  const property = data?.properties.find((p) => p.uuid === propertyId) ?? null;
  const propertyList = useMemo(() => (property ? [property] : []), [property]);
  const reservations = useMemo(() => data?.reservations ?? [], [data]);
  const linked = Boolean(property?.zodomusLinked || property?.zodomusPropertyId?.trim());
  const currency = property?.otaCurrency ?? property?.currency ?? null;

  const { properties: allProperties } = useProperties();
  const pricingAccess = usePricingAccess();
  const pricingOn = pricingAccess.enabled;
  const guestPriceOn = pricingAccess.guestPrice;
  // «Базовая цена» builds on «Цена для гостя» (the server switches it on only together).
  const basePriceOn = pricingAccess.basePrice && guestPriceOn;
  const basePrices = useBasePrices(propertyId, from, to, basePriceOn);
  const guestPrices = useGuestPrice(propertyId, from, to, basePriceOn);
  const promotions = useCalendarPromotions(from, to, pricingOn);
  const pricingRows = usePricingProperties(pricingOn);
  const pricingRow = pricingRows.data?.find((r) => r.id === propertyId) ?? null;
  const datesAccess = useCalendarDatesAccess();
  /**
   * Connected to Airbnb through RentAI: a night without its own Airbnb price or a base price goes to Airbnb at the
   * Booking price minus Basic — the A line shows that instead of «A —». Database only; a property outside the
   * Airbnb pilot (or Airbnb off) answers with an error, which reads as «not connected».
   */
  const airbnbListing = useQuery({
    queryKey: ['airbnb', 'listing', propertyId],
    queryFn: () => airbnbApi.listing(propertyId),
    enabled: basePriceOn,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const airbnbConnected = airbnbListing.data?.connected === true;
  /** ZODOMUS_AIRBNB_PRICE_FROM_BASE: own Airbnb prices (typed / base) are sent; off — every night goes by Booking. */
  const airbnbFromBase = airbnbListing.data?.priceFromBase === true;
  /** Nights from here on are kept closed on Airbnb (the end of the last full send). */
  const airbnbPlanEnd = airbnbListing.data?.planEnd ?? null;

  const nights = useMemo(
    () =>
      property
        ? buildMonthNights({
            from,
            to,
            today,
            property,
            reservations,
            promotions: promotions.data ?? [],
            geniusPct: pricingRow?.geniusPct ?? null,
            targetingPct: pricingRow?.targetingPct ?? null,
          })
        : [],
    [property, from, to, today, reservations, promotions.data, pricingRow],
  );
  const summary = useMemo(() => summarizeNights(nights), [nights]);

  const tDeals = useTranslations('calendar.propertyMonth.guestPrice.deals');
  /** «Базовая цена»: base / Booking / Airbnb of every night of the month. */
  const cellRows = useMemo(() => {
    const b = basePrices.data;
    const g = guestPrices.data;
    if (!basePriceOn || !b || !g) return undefined;
    const rows = new Map<string, CellRows>();
    for (const n of nights) {
      const baseHere = b.base[n.ymd] ?? null;
      // Only discounts that change a price RentAI sends: an Airbnb one counts only while Airbnb goes from the base.
      const pctHere = Math.max(b.discountPct?.booking[n.ymd] ?? 0, airbnbConnected && airbnbFromBase ? (b.discountPct?.airbnb[n.ymd] ?? 0) : 0);
      rows.set(n.ymd, {
        base: baseHere,
        discount: baseHere != null && pctHere > 0 ? { pct: pctHere } : null,
        booking: bookingCell(
          { ymd: n.ymd, rack: n.rack, rackFrom: n.rackFrom, rateName: n.rateName, onSale: n.kind === 'open', promotions: n.promotions, targetingPct: n.targetingPct },
          {
            base: b.base,
            typed: g.nightPrices.booking,
            markupPct: b.channels.booking.markupPct,
            geniusPct: pricingRow?.geniusPct ?? null,
            profile: g.profiles.booking,
            auto: b.auto,
            minPrice: pricingRow?.minPrice ?? null,
            discountPct: b.discountPct?.booking,
          },
        ),
        ...withGuest(n.ymd, airbnbCell(n)),
        airbnbTyped: g.nightPrices.airbnb[n.ymd] != null,
      });
    }
    return rows;

    /**
     * Not connected: typed, from the base, or the manual price of the settings (as before). Connected: what RentAI
     * sends — the own price (typed / base, whole złoty, not below the minimum) when that rule is on, else Booking −
     * Basic; nothing past the end of the last full send (kept closed there).
     */
    function airbnbCell(n: (typeof nights)[number]): { airbnb: number | null; airbnbFromBooking: boolean } {
      const minPrice = pricingRow?.minPrice ?? null;
      const airbnbPct = b!.discountPct?.airbnb[n.ymd];
      if (!airbnbConnected) {
        const own = airbnbNightPrice(n.ymd, g!.profiles.airbnb, g!.nightPrices.airbnb, { base: b!.base, markupPct: b!.channels.airbnb.markupPct });
        return { airbnb: own != null && ownAirbnb(n.ymd) ? discountedPrice(Math.round(own), airbnbPct, minPrice).price : own, airbnbFromBooking: false };
      }
      if (airbnbPlanEnd != null && n.ymd >= airbnbPlanEnd) return { airbnb: null, airbnbFromBooking: false };
      // The server prices only nights open on Booking (`airbnbNights`), the own price too.
      if (n.kind !== 'open') return { airbnb: null, airbnbFromBooking: false };
      if (airbnbFromBase) {
        const own = airbnbNightPrice(n.ymd, null, g!.nightPrices.airbnb, { base: b!.base, markupPct: b!.channels.airbnb.markupPct });
        // As the server: whole złoty, then the discount, then the minimum (rounded up).
        if (own != null) return { airbnb: wholeAboveMin(discountedPrice(Math.round(own), airbnbPct, null).price, minPrice), airbnbFromBooking: false };
      }
      const fromBooking = airbnbFromBooking(n.rack, n.promotions, minPrice);
      return { airbnb: fromBooking, airbnbFromBooking: fromBooking != null };
    }

    /** Airbnb's own lead-time discount on a one-night stay from this night, booked today: what the guest pays. */
    function withGuest(ymd: string, cell: { airbnb: number | null; airbnbFromBooking: boolean }) {
      if (!g!.airbnbDealsEnabled || cell.airbnb == null) return cell;
      const deal = airbnbLeadDeal(ymd, today, g!.airbnbDeals, { lastMinute: tDeals('lastMinute'), earlyBird: tDeals('earlyBird') });
      return deal ? { ...cell, airbnbGuest: { price: airbnbGuestNight(cell.airbnb, deal), label: deal.label, pct: deal.pct } } : cell;
    }

    /** The night has an Airbnb price of RentAI's own (typed or from the base) — the one a discount lowers. */
    function ownAirbnb(ymd: string): boolean {
      const typed = g!.nightPrices.airbnb[ymd];
      const base = b!.base[ymd];
      return (typed != null && typed > 0) || (base != null && base > 0);
    }
  }, [basePriceOn, basePrices.data, guestPrices.data, nights, pricingRow, airbnbConnected, airbnbFromBase, airbnbPlanEnd, today, tDeals]);

  // The Booking run is watched by the page: the panel remounts with each range and the phone sheet unmounts.
  // The dates tool off: no runs to poll (the server would answer 503). Not tied to the month's data: a month
  // that failed to load must not stop watching a run.
  const bookingSend = useBookingSend(propertyId, basePriceOn && datesAccess.enabled);

  /** «Отправить в Booking» of the base price works here: the old «Цена на канале» would only fight it. */
  const baseSends = basePriceOn && basePrices.data != null && basePrices.data.bookingSend == null;

  // `?from=…&to=…` (a range dragged in the general calendar) arrives picked, cut to the month on screen.
  const [selection, setSelection] = useState<NightSelection | null>(() => {
    const qFrom = searchParams.get('from');
    const qTo = searchParams.get('to');
    if (!qFrom || !qTo || !/^\d{4}-\d{2}-\d{2}$/.test(qFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(qTo)) return null;
    return rangeFromFields({ from: qFrom, to: qTo }, 'from', qFrom, from, to);
  });
  const shownKey = useRef(`${month}|${propertyId}`);
  useEffect(() => {
    const key = `${month}|${propertyId}`;
    if (key === shownKey.current) return;
    shownKey.current = key;
    setSelection(null);
  }, [month, propertyId]);
  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelection(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection]);
  const onPick = useCallback((ymd: string) => setSelection((s) => nextSelection(s, ymd)), []);
  const onRange = useCallback((a: string, b: string) => setSelection({ from: a, to: b }), []);
  /** «С» / «По» in the panel. */
  const onRangeField = useCallback(
    (field: 'from' | 'to', value: string) =>
      setSelection((s) => (s ? (rangeFromFields(s, field, value, from, to) ?? s) : s)),
    [from, to],
  );
  const pickedNights = useMemo(
    () => (selection ? nights.filter((n) => n.ymd >= selection.from && n.ymd <= selection.to) : []),
    [nights, selection],
  );
  /** Below `lg` the panel sits under the month; a button takes there (no auto-scroll: a second tap makes a range). */
  const panelRef = useRef<HTMLElement>(null);

  /** Sheets get the picked nights: check-out = the day after the last night. */
  const gridDates = selection ? { checkIn: selection.from, checkOut: addDaysYmd(selection.to, 1) } : null;
  const [priceOpen, setPriceOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountInitial, setDiscountInitial] = useState<PromotionFormInitial | null>(null);
  const [nightPromo, setNightPromo] = useState<string | null>(null);
  const [openReservation, setOpenReservation] = useState<Reservation | null>(null);
  const [taskReservation, setTaskReservation] = useState<Reservation | null>(null);
  // Sheets read their initial dates when they open: keep them while open even if the selection changes.
  const [sheetDates, setSheetDates] = useState<{ checkIn: string; checkOut: string } | null>(null);
  const withDates = (open: (o: boolean) => void) => () => {
    setSheetDates(gridDates);
    open(true);
  };

  const nightPromoView = useMemo(() => {
    if (!nightPromo || !property) return null;
    return {
      promotions: promotionsForCell(promotions.data ?? [], propertyId, nightPromo),
      rackPrice: property.otaNightlyPrices?.[nightPromo] ?? null,
      rate: property.otaNightlyPriceMeta?.[nightPromo] ? { name: property.otaNightlyPriceMeta[nightPromo]!.rateName ?? null } : null,
    };
  }, [nightPromo, property, promotions.data, propertyId]);

  const basePriceNode =
    basePriceOn && selection && basePrices.data && guestPrices.data ? (
      <BasePricePanel
        // The Airbnb mode comes from a query that may land after the pick: remount so the default channels follow.
        key={`${selection.from}|${selection.to}|${!airbnbConnected ? 'off' : airbnbFromBase ? 'base' : 'booking'}`}
        propertyId={propertyId}
        picked={pickedNights}
        monthFrom={from}
        monthTo={to}
        today={today}
        data={basePrices.data}
        airbnbMode={!airbnbConnected ? 'off' : airbnbFromBase ? 'base' : 'booking'}
        typed={guestPrices.data.nightPrices}
        currency={currency}
        minPrice={pricingRow?.minPrice ?? null}
        belowMin={pickedStayBelowMin(
          // room after every discount + cleaning against minimum × nights (decision 2026-10-25)
          pickedNights.map((n) => ({
            ymd: n.ymd,
            past: n.past,
            open: n.kind === 'open',
            minGuest: cellRows?.get(n.ymd)?.booking?.minGuest ?? null,
          })),
          guestPrices.data.profiles.booking?.cleaningFee,
          pricingRow?.minPrice,
        )}
        send={bookingSend}
      />
    ) : null;
  const guestPriceNode =
    guestPriceOn && selection ? (
      <GuestPricePanel
        propertyId={propertyId}
        from={from}
        to={to}
        picked={pickedNights}
        geniusPct={pricingRow?.geniusPct ?? null}
        minPrice={pricingRow?.minPrice ?? null}
        currency={currency}
        basePrices={basePriceOn ? (basePrices.data ?? null) : null}
        today={today}
      />
    ) : null;
  const nightActions = {
    onSetPrice: linked && !baseSends ? withDates(setPriceOpen) : undefined,
    onDiscount:
      pricingOn && linked && selection
        ? () => {
            setDiscountInitial({ propertyIds: [propertyId], stayFrom: selection.from, stayTo: selection.to });
            setDiscountOpen(true);
          }
        : undefined,
    onOpenDates: datesAccess.enabled && linked ? withDates(setDatesOpen) : undefined,
    onNewBooking: withDates(setBookingOpen),
    onOpenReservation: setOpenReservation,
    onNightDiscounts: pricingOn ? setNightPromo : undefined,
  };
  /** Phone: the picked nights go to a bottom sheet with tabs; the panel under the month keeps the month summary. */
  const sheetMode = isMobile && selection != null;

  const monthLabel = format(ymdToDate(from), 'LLLL yyyy', { locale: dateLocale });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border py-2">
        <Link
          href="/dashboard/calendar"
          className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{t('back')}</span>
        </Link>
        <div className="w-56 max-w-[60vw]">
          <Select
            aria-label={t('propertyAria')}
            value={propertyId}
            onChange={(e) => router.push(`/dashboard/calendar/${e.target.value}?month=${month}`)}
          >
            {allProperties.some((p) => p.id === propertyId) ? null : (
              <option value={propertyId}>{property?.title ?? '…'}</option>
            )}
            {allProperties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" aria-label={t('prevMonth')} onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <span className="min-w-[9.5rem] text-center text-sm font-semibold capitalize">{monthLabel}</span>
          <Button type="button" variant="ghost" size="icon" aria-label={t('nextMonth')} onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={month === monthOf(today)} onClick={() => setMonth(monthOf(today))}>
            {tc('today')}
          </Button>
          <span className="inline-flex h-4 w-4 items-center justify-center" aria-live="polite">
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label={t('loading')} /> : null}
          </span>
        </div>
      </div>

      {isError && !data ? (
        <CalendarError onRetry={() => refetch()} />
      ) : (isPending && !data) || (!property && isFetching) ? (
        // `!property && isFetching`: another property was picked, the previous one's data is still on screen.
        <div className="grid flex-1 gap-1 pt-4" aria-busy>
          <Skeleton className="h-[420px] w-full rounded-xl" />
        </div>
      ) : !property ? (
        <div className="p-6 text-sm text-muted-foreground">{t('notFound')}</div>
      ) : (
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pt-4 lg:flex-row lg:overflow-hidden',
            // the phone bar with the picked nights is pinned over the bottom of the page
            sheetMode && 'pb-24',
          )}
        >
          <div className="min-w-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
            {property.ariUnavailable ? (
              <p className="mb-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                {t('ariUnavailable')}
              </p>
            ) : null}
            {basePriceOn && datesAccess.enabled ? (
              <BookingSendStatus job={bookingSend.job} monthFrom={from} monthTo={to} onPick={onRange} />
            ) : null}
            <MonthGrid month={month} nights={nights} selection={selection} onPick={onPick} onRange={onRange} rows={cellRows} />
            <p className="mt-2 text-xs text-muted-foreground">{t('gridHint')}</p>
            {sheetMode && selection ? (
              <MobileNightSheet
                nights={nights}
                selection={selection}
                currency={currency}
                geniusPct={pricingRow?.geniusPct ?? null}
                minPrice={pricingRow?.minPrice ?? null}
                linked={linked}
                ariUnavailable={Boolean(property.ariUnavailable)}
                hideBelowMin={guestPriceOn}
                actions={nightActions}
                onClear={() => setSelection(null)}
                range={{ min: from, max: to, onChange: onRangeField }}
                basePrice={basePriceNode}
                guestPrice={guestPriceNode}
              />
            ) : selection ? (
              <div className="sticky bottom-2 z-10 mt-2 flex justify-center lg:hidden">
                <Button
                  type="button"
                  size="sm"
                  className="h-10 gap-1.5 rounded-full px-4 shadow-lg"
                  onClick={() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                >
                  <ChevronDown className="h-4 w-4" aria-hidden />
                  {t('toPanel')}
                </Button>
              </div>
            ) : null}
          </div>
          <aside ref={panelRef} className="shrink-0 scroll-mt-2 lg:w-[400px] lg:overflow-y-auto lg:pb-4" aria-label={t('panelAria')}>
            <NightPanel
              nights={nights}
              selection={sheetMode ? null : selection}
              summary={summary}
              currency={currency}
              geniusPct={pricingRow?.geniusPct ?? null}
              minPrice={pricingRow?.minPrice ?? null}
              linked={linked}
              ariUnavailable={Boolean(property.ariUnavailable)}
              onClear={() => setSelection(null)}
              range={{ min: from, max: to, onChange: onRangeField }}
              hideBelowMin={guestPriceOn}
              guestPrice={sheetMode ? null : guestPriceNode}
              basePrice={sheetMode ? null : basePriceNode}
              actions={nightActions}
            />
          </aside>
        </div>
      )}

      <SetOtaPriceSheet
        open={priceOpen}
        onOpenChange={setPriceOpen}
        properties={propertyList}
        initialPropertyId={propertyId}
        initialGridDates={sheetDates}
      />
      <NewBookingSheet
        open={bookingOpen}
        onOpenChange={setBookingOpen}
        properties={propertyList}
        initialPropertyId={propertyId}
        initialGridDates={sheetDates}
      />
      {datesAccess.enabled ? (
        <CalendarDatesSheet
          open={datesOpen}
          onOpenChange={setDatesOpen}
          properties={propertyList}
          initialPropertyId={propertyId}
          initialFrom={sheetDates?.checkIn ?? null}
          initialTo={sheetDates ? addDaysYmd(sheetDates.checkOut, -1) : null}
        />
      ) : null}
      {pricingOn ? (
        <>
          <PromotionFormSheet open={discountOpen} onOpenChange={setDiscountOpen} initial={discountInitial} />
          {nightPromo && nightPromoView ? (
            <CalendarPromotionDialog
              open={nightPromo != null}
              onOpenChange={(o) => !o && setNightPromo(null)}
              propertyId={propertyId}
              propertyTitle={property?.title ?? ''}
              ymd={nightPromo}
              promotions={nightPromoView.promotions}
              rackPrice={nightPromoView.rackPrice}
              currency={currency}
              geniusPct={pricingRow?.geniusPct ?? null}
              targetingPct={pricingRow?.targetingPct ?? null}
              rate={nightPromoView.rate}
            />
          ) : null}
        </>
      ) : null}

      <ResponsiveModal open={!!openReservation} onOpenChange={(o) => !o && setOpenReservation(null)} desktopPresentation="side">
        {openReservation ? (
          <ResponsiveModalContent
            title={openReservation.guestName}
            footer={
              <ReservationDetailPanelFooter
                reservation={openReservation}
                onCreateTask={(r) => {
                  setOpenReservation(null);
                  setTaskReservation(r);
                }}
                zodomusLinked={linked}
              />
            }
          >
            <ReservationDetailPanel
              reservation={openReservation}
              onCopy={() => toast.success(tc('copied'))}
              otaNightlyPrices={property?.otaNightlyPrices}
              otaNightlyPricesFrom={property?.otaNightlyPricesFrom}
              displayCurrencyFallback={currency}
            />
          </ResponsiveModalContent>
        ) : null}
      </ResponsiveModal>
      <div className="tasks-theme">
        <SmartCreateSheet
          open={!!taskReservation}
          onOpenChange={(o) => {
            if (!o) setTaskReservation(null);
          }}
          propertyId={taskReservation?.propertyId ?? ''}
          bookingLink={
            taskReservation
              ? { reservationUuid: taskReservation.uuid, propertyId: taskReservation.propertyId, checkOut: taskReservation.checkOut }
              : null
          }
        />
      </div>
    </div>
  );
}
