'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { Percent, RefreshCw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Drawer, DrawerClose, DrawerContent } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui.store';
import { bookingSuggestions, filterPropertiesBySearch } from '../calendarSearch';
import { parseLocalCalendarDay } from '../lib/calendar-api-dates';
import type { BookingChannel, BookingStatus, CalendarFilters, Property, Reservation } from '../types';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useDateLocale } from '@/hooks/useDateLocale';

const MOBILE_SUGGESTIONS_PER_GROUP = 5;

interface FilterBarProps {
  filters: CalendarFilters;
  onFiltersChange: (f: CalendarFilters) => void;
  properties: Property[];
  /** Для подсказок: поиск по имени гостя, email, номеру брони. */
  reservations: Reservation[];
  onNewBooking: () => void;
  showSyncOta?: boolean;
  /** `force` — удерживайте Shift при клике (принудительная перезапись уже синхронизированных броней). */
  onSyncOta?: (force?: boolean) => void;
  isSyncingOta?: boolean;
  /** false — без нижней границы (стык с `TimelineNavBar` в одной sticky-полосе). По умолчанию true. */
  showBottomBorder?: boolean;
  /** «Цены → Скидки» включены: кнопка «Скидка» для всех объектов. */
  onNewDiscount?: () => void;
  /** Phone: a booking picked from the search suggestions (move the grid to it and open it). */
  onPickReservation?: (r: Reservation) => void;
}

const CHANNELS: { value: BookingChannel | 'all'; labelKey: string }[] = [
  { value: 'all', labelKey: 'channelAll' },
  { value: 'booking', labelKey: 'channelBooking' },
  { value: 'airbnb', labelKey: 'channelAirbnb' },
  { value: 'direct', labelKey: 'channelDirect' },
];

const STATUSES: { value: BookingStatus | 'all'; labelKey: string }[] = [
  { value: 'all', labelKey: 'statusAll' },
  { value: 'confirmed', labelKey: 'statusConfirmed' },
  { value: 'pending', labelKey: 'statusPending' },
  { value: 'cleaning', labelKey: 'statusCleaning' },
  { value: 'cancelled', labelKey: 'statusCancelled' },
  { value: 'blocked', labelKey: 'statusBlocked' },
];

function ChannelStatusRow({
  filters,
  onFiltersChange,
  onNewBooking,
  showSyncOta,
  onSyncOta,
  isSyncingOta,
  onNewDiscount,
}: {
  filters: CalendarFilters;
  onFiltersChange: (f: CalendarFilters) => void;
  onNewBooking: () => void;
  showSyncOta?: boolean;
  /** `force` — удерживайте Shift при клике (принудительная перезапись уже синхронизированных броней). */
  onSyncOta?: (force?: boolean) => void;
  isSyncingOta?: boolean;
  onNewDiscount?: () => void;
}) {
  const t = useTranslations('calendar');
  const [forceOtaSync, setForceOtaSync] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {showSyncOta && onSyncOta && (
        <div
          className="flex flex-wrap items-center gap-2 sm:gap-3"
          title={t('syncOtaForceTooltip')}
        >
          <div className="flex items-center gap-1.5">
            <Checkbox
              id="cal-ota-force"
              checked={forceOtaSync}
              onCheckedChange={(v) => setForceOtaSync(v === true)}
              disabled={isSyncingOta}
              className="h-4 w-4"
            />
            <Label htmlFor="cal-ota-force" className="cursor-pointer text-[11px] font-normal text-muted-foreground">
              {t('syncOtaForceLabel')}
            </Label>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            disabled={isSyncingOta}
            onClick={(e) => onSyncOta?.(forceOtaSync || e.shiftKey)}
            aria-label={t('syncOta')}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isSyncingOta && 'animate-spin')} />
            {isSyncingOta ? t('syncOtaLoading') : t('syncOta')}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {CHANNELS.map(({ value, labelKey }) => (
          <button
            key={value}
            type="button"
            onClick={() => onFiltersChange({ ...filters, channelFilter: value })}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              filters.channelFilter === value
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background hover:bg-muted',
            )}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {STATUSES.map(({ value, labelKey }) => (
          <button
            key={value}
            type="button"
            onClick={() => onFiltersChange({ ...filters, statusFilter: value })}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              filters.statusFilter === value
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background hover:bg-muted',
            )}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
      {onNewDiscount ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
          onClick={onNewDiscount}
        >
          <Percent className="h-3.5 w-3.5" aria-hidden />
          {t('newDiscount')}
        </Button>
      ) : null}
      <Button type="button" size="sm" className="hidden md:inline-flex" onClick={onNewBooking}>
        {t('newBooking')}
      </Button>
    </div>
  );
}

export function FilterBar({
  filters,
  onFiltersChange,
  properties,
  reservations,
  onNewBooking,
  showSyncOta,
  onSyncOta,
  isSyncingOta,
  showBottomBorder = true,
  onNewDiscount,
  onPickReservation,
}: FilterBarProps) {
  const t = useTranslations('calendar');
  const isMobile = useIsMobile();
  const dateLocale = useDateLocale();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { setOpenCalendarFilter } = useUiStore();

  /** Регистрируем колбэк в ui.store, чтобы кнопка фильтра в Header могла открыть Drawer */
  useEffect(() => {
    setOpenCalendarFilter(() => setDrawerOpen(true));
    return () => setOpenCalendarFilter(null);
  }, [setOpenCalendarFilter]);
  const [query, setQuery] = useState(filters.propertyQuery);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const suggestions = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return filterPropertiesBySearch(properties, reservations, q).slice(0, 8);
  }, [properties, reservations, query]);

  const search = (
    <div className="relative w-full max-w-md">
      <Input
        placeholder={t('searchPlaceholder')}
        value={query}
        onChange={(e) => {
          const v = e.target.value;
          setQuery(v);
          onFiltersChange({ ...filters, propertyQuery: v });
        }}
        onFocus={() => setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
      />
      {showSuggestions && query.trim().length > 0 && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg ring-1 ring-black/5 dark:ring-white/10">
          {suggestions.map((p) => (
            <li key={p.uuid}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none active:bg-muted"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setQuery(p.title);
                  onFiltersChange({ ...filters, propertyQuery: p.title });
                  setShowSuggestions(false);
                }}
              >
                {p.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const setSearch = (v: string) => {
    setQuery(v);
    onFiltersChange({ ...filters, propertyQuery: v });
  };
  const propertyTitleById = useMemo(() => new Map(properties.map((p) => [p.uuid, p.title])), [properties]);
  const mobileBookings = useMemo(
    () => (isMobile && onPickReservation ? bookingSuggestions(reservations, query, format(new Date(), 'yyyy-MM-dd'), MOBILE_SUGGESTIONS_PER_GROUP) : []),
    [isMobile, onPickReservation, reservations, query],
  );
  const mobileProperties = suggestions.slice(0, MOBILE_SUGGESTIONS_PER_GROUP);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  /** A booking with an empty guest name is shown and searched by its number. */
  const guestLabel = (r: Reservation) => r.guestName.trim() || r.externalId;
  const stayLabel = (r: Reservation) =>
    `${format(parseLocalCalendarDay(r.checkIn), 'd MMM', { locale: dateLocale })} → ${format(parseLocalCalendarDay(r.checkOut), 'd MMM', { locale: dateLocale })}`;

  /**
   * Phone: the search stays on screen above the grid (it used to hide in the «Фильтры» sheet, so an active
   * query was invisible). Suggestions: properties, then bookings found by guest / email / phone / number.
   */
  const mobileSearch = (
    <div className="relative w-full">
      <div className="flex h-11 w-full items-center rounded-md border border-input bg-input-fill focus-within:ring-2 focus-within:ring-ring">
        <Search className="ml-3 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          aria-label={t('searchPlaceholder')}
          placeholder={t('searchPlaceholder')}
          ref={mobileInputRef}
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground"
          value={query}
          onChange={(e) => {
            setSearch(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        />
        {query ? (
          <button
            type="button"
            aria-label={t('searchClear')}
            className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setSearch('')}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>
      {showSuggestions && query.trim().length > 0 && (mobileProperties.length > 0 || mobileBookings.length > 0) ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[55vh] overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg ring-1 ring-black/5 dark:ring-white/10">
          {mobileProperties.length > 0 ? (
            <>
              <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('searchGroupProperties')}</p>
              <ul>
                {mobileProperties.map((p) => (
                  <li key={p.uuid}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none active:bg-muted"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSearch(p.title);
                        setShowSuggestions(false);
                        // hide the phone keyboard so the grid is visible
                        mobileInputRef.current?.blur();
                      }}
                    >
                      {p.title}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {mobileBookings.length > 0 ? (
            <>
              <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('searchGroupBookings')}</p>
              <ul>
                {mobileBookings.map((r) => (
                  <li key={r.uuid}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none active:bg-muted"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSearch(guestLabel(r));
                        setShowSuggestions(false);
                        mobileInputRef.current?.blur();
                        onPickReservation?.(r);
                      }}
                    >
                      <span className="text-sm font-medium">{guestLabel(r)}</span>
                      <span className="text-xs text-muted-foreground">
                        {propertyTitleById.get(r.propertyId) ?? ''} · {stayLabel(r)}
                        {r.status === 'cancelled' ? ` · ${t('statusCancelled')}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      className={cn(
        'flex w-full min-w-0 max-w-full shrink-0 flex-col gap-1.5 px-4 py-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-2 sm:gap-y-1.5 sm:py-2',
        showBottomBorder && 'border-b border-border',
      )}
    >
      {!isMobile && (
        <>
          <div className="flex min-w-0 flex-1 justify-center px-2">{search}</div>
          <div className="min-w-0 max-w-full overflow-x-auto py-0.5">
            <ChannelStatusRow
              filters={filters}
              onFiltersChange={onFiltersChange}
              onNewBooking={onNewBooking}
              showSyncOta={showSyncOta}
              onSyncOta={onSyncOta}
              isSyncingOta={isSyncingOta}
              onNewDiscount={onNewDiscount}
            />
          </div>
        </>
      )}

      {isMobile && mobileSearch}

      {isMobile && (
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerContent title={t('filters')} className="max-h-[90vh]">
            <div className="space-y-4 px-2 pb-6">
              <ChannelStatusRow
                filters={filters}
                onFiltersChange={onFiltersChange}
                onNewBooking={onNewBooking}
                showSyncOta={showSyncOta}
                onSyncOta={onSyncOta}
                isSyncingOta={isSyncingOta}
                onNewDiscount={
                  onNewDiscount
                    ? () => {
                        onNewDiscount();
                        setDrawerOpen(false);
                      }
                    : undefined
                }
              />
              <Button
                type="button"
                className="w-full"
                onClick={() => {
                  onNewBooking();
                  setDrawerOpen(false);
                }}
              >
                {t('newBooking')}
              </Button>
              <DrawerClose asChild>
                <Button variant="outline" className="w-full" type="button">
                  {t('close')}
                </Button>
              </DrawerClose>
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}
