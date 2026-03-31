'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { Epg, Layout, useEpg } from 'planby';
import type { Channel } from 'planby';
import { eachDayOfInterval, format, parseISO, startOfDay } from 'date-fns';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { ResponsivePanel } from '@/components/ui/responsive-panel';
import { Separator } from '@/components/ui/separator';
import { useDateLocale } from '@/hooks/useDateLocale';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import type { CalendarDateRange, CalendarFilters, Reservation } from './types';
import { useCalendarData } from './hooks/useCalendarData';
import { useCalendarFilters } from './hooks/useCalendarFilters';
import { getPropertyMeta, countNights } from './lib/property-meta';
import { ProgramBlock } from './components/ProgramBlock';
import { TimelineHeader } from './components/TimelineHeader';
import { SidebarChannel } from './components/SidebarChannel';
import { CalendarSkeleton } from './components/CalendarSkeleton';
import { CalendarEmptyNoProperties, CalendarEmptyNoReservations } from './components/CalendarEmpty';
import { CalendarError } from './components/CalendarError';
import { FilterBar } from './components/FilterBar';
import { TimelineNavBar } from './components/TimelineNavBar';
import { getCalendarPlanbyTheme } from './lib/planby-app-theme';

const ITEM_HEIGHT_PX = 64;

const statusConfig: Record<
  Reservation['status'],
  { classes: string; labelKey: string }
> = {
  confirmed: { classes: 'bg-blue-100 text-blue-700 border-blue-200', labelKey: 'statusConfirmed' },
  pending: { classes: 'bg-amber-100 text-amber-700 border-amber-200', labelKey: 'statusPending' },
  cleaning: { classes: 'bg-rose-100 text-rose-700 border-rose-200', labelKey: 'statusCleaning' },
  blocked: { classes: 'bg-gray-100 text-gray-500 border-gray-200', labelKey: 'statusBlocked' },
};

const channelLabelKeys: Record<Reservation['channel'], string> = {
  booking: 'channelBooking',
  airbnb: 'channelAirbnb',
  direct: 'channelDirect',
  other: 'channelOther',
};

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

  const properties = data?.properties ?? [];
  const reservations = data?.reservations ?? [];
  const { filteredProperties, filteredReservations } = useCalendarFilters(properties, reservations, filters);

  const [selected, setSelected] = useState<Reservation | null>(null);

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
        since: format(startOfDay(parseISO(r.checkIn)), "yyyy-MM-dd'T'HH:mm:ss"),
        till: format(startOfDay(parseISO(r.checkOut)), "yyyy-MM-dd'T'HH:mm:ss"),
        _reservation: r,
      })),
    [filteredReservations],
  );

  const { getEpgProps, getLayoutProps } = useEpg({
    channels,
    epg,
    startDate: format(dateRange.start, "yyyy-MM-dd'T'00:00:00"),
    endDate: format(dateRange.end, "yyyy-MM-dd'T'00:00:00"),
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
  const { hourWidth: layoutHourWidth, itemHeight: layoutItemHeight } = layoutProps;
  const dayColWidthPx = 24 * layoutHourWidth;

  const onSelectReservation = useCallback((r: Reservation) => setSelected(r), []);

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
`;
    },
    [calendarScopeId, dayColWidthPx, layoutItemHeight],
  );

  if (isError) {
    return (
      <div className="flex flex-1 flex-col">
        <FilterBar
          filters={filters}
          onFiltersChange={onFiltersChange}
          properties={properties}
          filteredCount={filteredProperties.length}
        />
        <CalendarError onRetry={() => refetch()} />
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
          filteredCount={0}
        />
        <CalendarSkeleton />
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div className="flex flex-1 flex-col">
        <FilterBar filters={filters} onFiltersChange={onFiltersChange} properties={[]} filteredCount={0} />
        <CalendarEmptyNoProperties />
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 max-w-full flex-col overflow-x-hidden">
      <FilterBar
        filters={filters}
        onFiltersChange={onFiltersChange}
        properties={properties}
        filteredCount={filteredProperties.length}
      />
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

      <ResponsivePanel open={!!selected} onOpenChange={(o) => !o && setSelected(null)} title={selected?.guestName ?? ''}>
        {selected && (
          <ReservationPanelContent reservation={selected} locale={locale} onCopy={() => toast.success(t('copied'))} />
        )}
      </ResponsivePanel>
    </div>
  );
}

function ReservationPanelContent({
  reservation,
  locale,
  onCopy,
}: {
  reservation: Reservation;
  locale: import('date-fns').Locale;
  onCopy: () => void;
}) {
  const t = useTranslations('calendar');
  const nights = countNights(reservation.checkIn, reservation.checkOut);
  const st = statusConfig[reservation.status];

  return (
    <div className="space-y-4">
      <p className="text-lg font-semibold">{reservation.guestName}</p>
      <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs font-medium', st.classes)}>
        {t(st.labelKey)}
      </span>
      <p className="text-sm text-muted-foreground">
        {t(channelLabelKeys[reservation.channel])}
      </p>
      <p className="text-sm">
        {format(parseISO(reservation.checkIn), 'dd MMM yyyy', { locale })} →{' '}
        {format(parseISO(reservation.checkOut), 'dd MMM yyyy', { locale })}
      </p>
      <p className="text-sm text-muted-foreground">
        {nights} {t('nights')}
      </p>
      <p className="text-base font-medium">
        {new Intl.NumberFormat(undefined, { style: 'currency', currency: reservation.currency }).format(reservation.totalPrice)}
      </p>
      <Separator />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono">{reservation.externalId}</code>
        <button
          type="button"
          className="rounded p-1 hover:bg-muted"
          aria-label={t('copyId')}
          onClick={() => {
            void navigator.clipboard.writeText(reservation.externalId);
            onCopy();
          }}
        >
          <Copy className="h-4 w-4" />
        </button>
      </div>
      {reservation.chatThreadId ? (
        <Button asChild className="w-full">
          <Link href={`/chat?thread=${reservation.chatThreadId}`}>{t('openChat')}</Link>
        </Button>
      ) : (
        <Button disabled className="w-full" title={t('chatUnavailable')}>
          {t('openChat')}
        </Button>
      )}
    </div>
  );
}
