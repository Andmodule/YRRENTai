'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import { isNotSent, isTargetingType, nightsCount } from '@/modules/pricing/lib/pricing-ui';
import { useStayRangeFormatter } from '@/modules/pricing/components/shared';
import type { MonthNight, NightSelection } from '../lib/property-month';
import {
  NightActions,
  NightBookings,
  NightPriceTable,
  usePickedNights,
  type NightPanelActions,
} from './NightPanel';

type SheetTab = 'price' | 'discount' | 'sales' | 'booking';
const TABS: readonly SheetTab[] = ['price', 'discount', 'sales', 'booking'];
/** vaul's close animation is 0.5s (TRANSITIONS.DURATION); a little more so the old layer is gone first. */
const SHEET_CLOSE_MS = 600;

/**
 * Phone (< md): the picked nights live in a bar pinned to the bottom; «Изменить» opens a bottom sheet
 * with tabs Цена · Скидка · Продажи · Бронь instead of the long panel under the month.
 * The bar is not modal, so a second tap on the month still makes a range.
 * The month column reserves room for the bar (`pb-24` in PropertyMonthView).
 */
export function MobileNightSheet({
  nights,
  selection,
  currency,
  geniusPct,
  minPrice,
  linked,
  ariUnavailable,
  hideBelowMin,
  actions,
  onClear,
  basePrice,
  guestPrice,
}: {
  nights: readonly MonthNight[];
  selection: NightSelection;
  currency: string | null;
  geniusPct: number | null;
  minPrice: number | null;
  linked: boolean;
  ariUnavailable: boolean;
  hideBelowMin: boolean;
  actions: NightPanelActions;
  onClear: () => void;
  basePrice?: ReactNode;
  guestPrice?: ReactNode;
}) {
  const t = useTranslations('calendar.propertyMonth');
  const ts = useTranslations('calendar.propertyMonth.sheet');
  const fmtRange = useStayRangeFormatter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SheetTab>('price');
  const { picked, bookings, discounts, allPast } = usePickedNights(nights, selection);

  // Another sheet (discount, dates, new booking, a booking) opens only after this one has slid away:
  // two modal layers at once fight over focus and the page scroll lock.
  // Not vaul's `onAnimationEnd`: it fires only when vaul closes itself (swipe, overlay, X), not on our `open={false}`.
  const pending = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (open) {
      pending.current = null;
      return;
    }
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    const timer = window.setTimeout(next, SHEET_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [open]);
  const afterClose = <A extends unknown[]>(fn: ((...args: A) => void) | undefined) =>
    fn
      ? (...args: A) => {
          pending.current = () => fn(...args);
          setOpen(false);
        }
      : undefined;
  const sheetActions: NightPanelActions = {
    onSetPrice: afterClose(actions.onSetPrice),
    onDiscount: afterClose(actions.onDiscount),
    onOpenDates: afterClose(actions.onOpenDates),
    onNewBooking: afterClose(actions.onNewBooking)!,
    onOpenReservation: afterClose(actions.onOpenReservation)!,
    onNightDiscounts: afterClose(actions.onNightDiscounts),
  };

  const sales = useMemo(() => {
    const c = { open: 0, closed: 0, booked: 0 };
    for (const n of picked) {
      if (n.kind === 'open') c.open++;
      else if (n.kind === 'booked' || n.kind === 'blocked') c.booked++;
      else if (n.kind === 'closed') c.closed++;
    }
    return c;
  }, [picked]);

  const single = selection.from === selection.to;
  const title = fmtRange(selection.from, selection.to);
  const nightsLabel = t('nights', { count: nightsCount(selection.from, selection.to) });

  /** Arrow keys move between tabs (only the picked tab is in the Tab order). */
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length]!;
    setTab(next);
    document.getElementById(`night-tab-${next}`)?.focus();
  };

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-border bg-card px-4 pt-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.35)] pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        role="region"
        aria-label={ts('barAria')}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {nightsLabel}
            {allPast ? ` · ${t('past')}` : single ? ` · ${ts('pickSecond')}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label={t('clear')}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
        <Button type="button" className="h-11 shrink-0 px-5 text-base font-semibold" onClick={() => setOpen(true)}>
          {ts('edit')}
        </Button>
      </div>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent
          title={title}
          description={nightsLabel}
          headerAdornment={
            <div role="tablist" aria-label={ts('tabsAria')} onKeyDown={onTabKey} className="grid grid-cols-4 gap-1 rounded-xl bg-muted p-1">
              {TABS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`night-tab-${id}`}
                  aria-selected={tab === id}
                  aria-controls={tab === id ? `night-tabpanel-${id}` : undefined}
                  tabIndex={tab === id ? 0 : -1}
                  onClick={() => setTab(id)}
                  className={cn(
                    'h-10 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    tab === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
                  )}
                >
                  {ts(`tab.${id}`)}
                </button>
              ))}
            </div>
          }
        >
          <div role="tabpanel" id={`night-tabpanel-${tab}`} aria-labelledby={`night-tab-${tab}`} className="space-y-4 pb-2">
            {!linked ? <p className="text-sm text-amber-700 dark:text-amber-400">{t('notLinked')}</p> : null}

            {tab === 'price' ? (
              <>
                {basePrice}
                {guestPrice}
                {sheetActions.onSetPrice ? <NightActions actions={sheetActions} allPast={allPast} only={['price']} /> : null}
                <NightPriceTable
                  picked={picked}
                  discounts={discounts}
                  currency={currency}
                  geniusPct={geniusPct}
                  minPrice={minPrice}
                  ariUnavailable={ariUnavailable}
                  hideBelowMin={hideBelowMin}
                  onNightDiscounts={sheetActions.onNightDiscounts}
                />
              </>
            ) : null}

            {tab === 'discount' ? (
              <>
                {sheetActions.onDiscount ? <NightActions actions={sheetActions} allPast={allPast} only={['discount']} /> : null}
                {discounts.length > 0 ? (
                  <ul className="space-y-2">
                    {discounts.map((p) => (
                      <li key={p.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                        <span className="font-medium">«{p.name}» −{p.discountPct}%</span>
                        <span className="block text-xs text-muted-foreground">
                          {isNotSent(p.state)
                            ? t('dState.notSent')
                            : isTargetingType(p.promotionType)
                              ? t('dState.targeting')
                              : p.state === 'on'
                                ? p.confirmed
                                  ? t('dState.on')
                                  : t('dState.unconfirmed')
                                : p.state === 'pending'
                                  ? t('dState.pending')
                                  : t('dState.dry')}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{ts('discountsNone')}</p>
                )}
              </>
            ) : null}

            {tab === 'sales' ? (
              <>
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-muted px-2 py-2">
                    <dt className="text-[11px] text-muted-foreground">{t('sumOpen')}</dt>
                    <dd className="text-lg font-semibold tabular-nums">{sales.open}</dd>
                  </div>
                  <div className="rounded-lg bg-muted px-2 py-2">
                    <dt className="text-[11px] text-muted-foreground">{t('sumBooked')}</dt>
                    <dd className="text-lg font-semibold tabular-nums">{sales.booked}</dd>
                  </div>
                  <div className="rounded-lg bg-muted px-2 py-2">
                    <dt className="text-[11px] text-muted-foreground">{t('sumClosed')}</dt>
                    <dd className="text-lg font-semibold tabular-nums">{sales.closed}</dd>
                  </div>
                </dl>
                {sheetActions.onOpenDates ? (
                  <NightActions actions={sheetActions} allPast={allPast} only={['dates']} />
                ) : (
                  <p className="text-sm text-muted-foreground">{ts('salesOff')}</p>
                )}
                <p className="text-xs text-muted-foreground">{ts('salesNote')}</p>
              </>
            ) : null}

            {tab === 'booking' ? (
              <>
                <NightActions actions={sheetActions} allPast={allPast} only={['booking']} />
                {bookings.length > 0 ? (
                  <NightBookings bookings={bookings} onOpen={sheetActions.onOpenReservation} />
                ) : (
                  <p className="text-sm text-muted-foreground">{ts('bookingsNone')}</p>
                )}
              </>
            ) : null}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
