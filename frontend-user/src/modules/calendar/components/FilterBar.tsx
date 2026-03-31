'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Filter, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Drawer, DrawerClose, DrawerContent } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import type { BookingChannel, BookingStatus, CalendarFilters, Property } from '../types';
import { useIsMobile } from '@/hooks/useIsMobile';

interface FilterBarProps {
  filters: CalendarFilters;
  onFiltersChange: (f: CalendarFilters) => void;
  properties: Property[];
  filteredCount: number;
  onNewBooking: () => void;
  showSyncOta?: boolean;
  /** `force` — удерживайте Shift при клике (принудительная перезапись уже синхронизированных броней). */
  onSyncOta?: (force?: boolean) => void;
  isSyncingOta?: boolean;
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
];

function ChannelStatusRow({
  filters,
  onFiltersChange,
  onNewBooking,
  showSyncOta,
  onSyncOta,
  isSyncingOta,
}: {
  filters: CalendarFilters;
  onFiltersChange: (f: CalendarFilters) => void;
  onNewBooking: () => void;
  showSyncOta?: boolean;
  /** `force` — удерживайте Shift при клике (принудительная перезапись уже синхронизированных броней). */
  onSyncOta?: (force?: boolean) => void;
  isSyncingOta?: boolean;
}) {
  const t = useTranslations('calendar');
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {showSyncOta && onSyncOta && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={isSyncingOta}
          title={t('syncOtaShiftHint')}
          onClick={(e) => onSyncOta?.(e.shiftKey)}
          aria-label={t('syncOta')}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isSyncingOta && 'animate-spin')} />
          {isSyncingOta ? t('syncOtaLoading') : t('syncOta')}
        </Button>
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
  filteredCount,
  onNewBooking,
  showSyncOta,
  onSyncOta,
  isSyncingOta,
}: FilterBarProps) {
  const t = useTranslations('calendar');
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [query, setQuery] = useState(filters.propertyQuery);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return properties.filter((p) => p.title.toLowerCase().includes(q)).slice(0, 8);
  }, [properties, query]);

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
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md">
          {suggestions.map((p) => (
            <li key={p.uuid}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
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
    <div className="flex w-full min-w-0 max-w-full shrink-0 flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-2 sm:gap-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate text-lg font-semibold tracking-tight">{t('title')}</h1>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{filteredCount}</span>
        {isMobile && (
          <Button variant="outline" size="icon" className="ml-auto" type="button" aria-label={t('filters')} onClick={() => setDrawerOpen(true)}>
            <Filter className="h-4 w-4" />
          </Button>
        )}
      </div>

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
