'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Percent, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Drawer, DrawerClose, DrawerContent } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui.store';
import { filterPropertiesBySearch } from '../calendarSearch';
import type { BookingChannel, BookingStatus, CalendarFilters, Property, Reservation } from '../types';
import { useIsMobile } from '@/hooks/useIsMobile';

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
}: FilterBarProps) {
  const t = useTranslations('calendar');
  const isMobile = useIsMobile();
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

      {isMobile && (
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerContent title={t('filters')} className="max-h-[90vh]">
            <div className="space-y-4 px-2 pb-6">
              {search}
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
