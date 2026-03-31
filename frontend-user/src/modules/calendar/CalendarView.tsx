'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { Epg, Layout, useEpg } from 'planby';
import type { Channel } from 'planby';
import { addDays, eachDayOfInterval, format, parseISO, startOfDay } from 'date-fns';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ResponsiveModal, ResponsiveModalContent } from '@/components/ui/responsive-modal';
import { Separator } from '@/components/ui/separator';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDateLocale } from '@/hooks/useDateLocale';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import type { CalendarDateRange, CalendarFilters, Reservation } from './types';
import { useCalendarData } from './hooks/useCalendarData';
import { useCalendarFilters } from './hooks/useCalendarFilters';
import { useZodomusCalendarSync } from './hooks/useZodomusCalendarSync';
import { getPropertyMeta, countNights } from './lib/property-meta';
import { calendarStatusClasses } from './lib/calendar-status-styles';
import { ProgramBlock } from './components/ProgramBlock';
import { TimelineHeader } from './components/TimelineHeader';
import { SidebarChannel } from './components/SidebarChannel';
import { CalendarSkeleton } from './components/CalendarSkeleton';
import { CalendarEmptyNoProperties, CalendarEmptyNoReservations } from './components/CalendarEmpty';
import { CalendarError } from './components/CalendarError';
import { FilterBar } from './components/FilterBar';
import { TimelineNavBar } from './components/TimelineNavBar';
import { NewBookingSheet } from './components/NewBookingSheet';
import { getCalendarPlanbyTheme } from './lib/planby-app-theme';

const ITEM_HEIGHT_PX = 64;

const statusLabelKey: Record<Reservation['status'], string> = {
  confirmed: 'statusConfirmed',
  pending: 'statusPending',
  cleaning: 'statusCleaning',
  blocked: 'statusBlocked',
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
  const zodomusSync = useZodomusCalendarSync(1);

  const properties = data?.properties ?? [];
  const reservations = data?.reservations ?? [];
  const { filteredProperties, filteredReservations } = useCalendarFilters(properties, reservations, filters);

  const [selected, setSelected] = useState<Reservation | null>(null);
  const [newBookingOpen, setNewBookingOpen] = useState(false);

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
      if (!t.closest('[data-testid="content"]')) return;
      setNewBookingOpen(true);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [planbyScrollRef, filteredProperties.length]);

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

  const openNewBooking = useCallback(() => setNewBookingOpen(true), []);

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
          filteredCount={filteredProperties.length}
          onNewBooking={openNewBooking}
          showSyncOta={showSyncOta}
          onSyncOta={onSyncOta}
          isSyncingOta={zodomusSync.isPending}
        />
        <CalendarError onRetry={() => refetch()} />
        <NewBookingSheet open={newBookingOpen} onOpenChange={setNewBookingOpen} properties={properties} />
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
          onNewBooking={openNewBooking}
          showSyncOta={showSyncOta}
          onSyncOta={onSyncOta}
          isSyncingOta={zodomusSync.isPending}
        />
        <CalendarSkeleton />
        <NewBookingSheet open={newBookingOpen} onOpenChange={setNewBookingOpen} properties={properties} />
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
          filteredCount={0}
          onNewBooking={openNewBooking}
          showSyncOta={false}
        />
        <CalendarEmptyNoProperties />
        <NewBookingSheet open={newBookingOpen} onOpenChange={setNewBookingOpen} properties={properties} />
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

      <ResponsiveModal open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        {selected && (
          <ResponsiveModalContent title={selected.guestName}>
            <ReservationPanelContent reservation={selected} locale={locale} onCopy={() => toast.success(t('copied'))} />
          </ResponsiveModalContent>
        )}
      </ResponsiveModal>

      <NewBookingSheet open={newBookingOpen} onOpenChange={setNewBookingOpen} properties={properties} />
    </div>
    </TooltipProvider>
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
  const stClass = calendarStatusClasses[reservation.status];

  return (
    <div className="space-y-4">
      <p className="text-lg font-semibold text-foreground">{reservation.guestName}</p>
      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', stClass)}>
        {t(statusLabelKey[reservation.status])}
      </span>
      <p className="text-sm text-muted-foreground">
        {t(channelLabelKeys[reservation.channel])}
        {reservation.fromOta ? (
          <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
            {t('otaSyncedBadge')}
          </span>
        ) : null}
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
