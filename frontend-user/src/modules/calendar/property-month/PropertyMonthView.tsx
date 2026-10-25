'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
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
  shiftMonth,
  summarizeNights,
} from '../lib/property-month';
import { MonthGrid } from './MonthGrid';
import { NightPanel } from './NightPanel';
import { GuestPricePanel } from './GuestPricePanel';
import { BasePricePanel } from './BasePricePanel';
import type { CellRows } from './MonthGrid';
import { airbnbNightPrice, bookingCell, pickedStayBelowMin } from '@/modules/pricing/lib/guest-price';

/** Calendar of one property by months (Airbnb-like): the month on the left, actions and prices on the right. */
export function PropertyMonthView({ propertyId }: { propertyId: string }) {
  const t = useTranslations('calendar.propertyMonth');
  const tc = useTranslations('calendar');
  const dateLocale = useDateLocale();
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

  /** «Базовая цена»: base / Booking / Airbnb of every night of the month. */
  const cellRows = useMemo(() => {
    const b = basePrices.data;
    const g = guestPrices.data;
    if (!basePriceOn || !b || !g) return undefined;
    const rows = new Map<string, CellRows>();
    for (const n of nights) {
      rows.set(n.ymd, {
        base: b.base[n.ymd] ?? null,
        booking: bookingCell(
          { ymd: n.ymd, rack: n.rack, rackFrom: n.rackFrom, rateName: n.rateName, onSale: n.kind === 'open', promotions: n.promotions, targetingPct: n.targetingPct },
          { base: b.base, typed: g.nightPrices.booking, markupPct: b.channels.booking.markupPct, geniusPct: pricingRow?.geniusPct ?? null, profile: g.profiles.booking },
        ),
        airbnb: airbnbNightPrice(n.ymd, g.profiles.airbnb, g.nightPrices.airbnb, { base: b.base, markupPct: b.channels.airbnb.markupPct }),
        airbnbTyped: g.nightPrices.airbnb[n.ymd] != null,
      });
    }
    return rows;
  }, [basePriceOn, basePrices.data, guestPrices.data, nights, pricingRow]);

  /** «Отправить в Booking» of the base price works here: the old «Цена на канале» would only fight it. */
  const baseSends = basePriceOn && basePrices.data != null && basePrices.data.bookingSend == null;

  const [selection, setSelection] = useState<NightSelection | null>(null);
  useEffect(() => setSelection(null), [month, propertyId]);
  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelection(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection]);
  const onPick = useCallback((ymd: string) => setSelection((s) => nextSelection(s, ymd)), []);
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
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pt-4 lg:flex-row lg:overflow-hidden">
          <div className="min-w-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
            {property.ariUnavailable ? (
              <p className="mb-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                {t('ariUnavailable')}
              </p>
            ) : null}
            <MonthGrid month={month} nights={nights} selection={selection} onPick={onPick} rows={cellRows} />
            <p className="mt-2 text-xs text-muted-foreground">{t('gridHint')}</p>
            {selection ? (
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
              selection={selection}
              summary={summary}
              currency={currency}
              geniusPct={pricingRow?.geniusPct ?? null}
              minPrice={pricingRow?.minPrice ?? null}
              linked={linked}
              ariUnavailable={Boolean(property.ariUnavailable)}
              onClear={() => setSelection(null)}
              hideBelowMin={guestPriceOn}
              guestPrice={
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
                  />
                ) : null
              }
              basePrice={
                basePriceOn && selection && basePrices.data && guestPrices.data ? (
                  <BasePricePanel
                    key={`${selection.from}|${selection.to}`}
                    propertyId={propertyId}
                    picked={pickedNights}
                    monthFrom={from}
                    monthTo={to}
                    today={today}
                    data={basePrices.data}
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
                  />
                ) : null
              }
              actions={{
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
              }}
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
