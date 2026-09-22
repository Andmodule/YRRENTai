'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { Epg, Layout, useEpg } from 'planby';
import type { Channel, Theme } from 'planby';
import type { ProgramItem as PlanbyProgramRow } from 'planby/dist/Epg/helpers/types';
import type { Locale } from 'date-fns';
import { addDays, addHours, eachDayOfInterval, format, startOfDay } from 'date-fns';
import type { CalendarDateRange, Property, Reservation } from '../types';
import { useCalendarTimelinePan } from '../hooks/use-calendar-timeline-pan';
import { usePreservePlanbyScroll } from '../hooks/use-preserve-planby-scroll';
import { getPropertyMeta } from '../lib/property-meta';
import { parseLocalCalendarDay } from '../lib/calendar-api-dates';
import { hitTestCalendarCell } from '../lib/hit-test-calendar-cell';
import { ProgramBlock } from './ProgramBlock';
import { TimelineHeader } from './TimelineHeader';
import { SidebarChannel } from './SidebarChannel';

const ITEM_HEIGHT_PX = 64;
const DAY_COLUMN_WIDTH_PX = {
  mobile: 64,
  desktop: 96,
} as const;

export interface CalendarPlanbyGridProps {
  calendarScopeId: string;
  dateRange: CalendarDateRange;
  onDateRangeChange: (r: CalendarDateRange) => void;
  filteredProperties: Property[];
  filteredReservations: Reservation[];
  /** Measured container size — optional; Planby self-measures when omitted. */
  width?: number;
  height?: number;
  isMobile: boolean;
  locale: Locale;
  planbyTheme: Theme;
  timelinePanEnabled: boolean;
  onSelectReservation: (r: Reservation) => void;
  onEmptyCellClick: (payload: {
    propertyId: string;
    propertyTitle: string | undefined;
    checkIn: string;
    checkOut: string;
    zodomusLinked: boolean;
  }) => void;
}

/**
 * Isolated Planby host: mounts only with valid width/height so useLayout
 * initializes layoutHeight correctly (avoids empty sidebar until scroll).
 */
export function CalendarPlanbyGrid({
  calendarScopeId,
  dateRange,
  onDateRangeChange,
  filteredProperties,
  filteredReservations,
  width,
  height,
  isMobile,
  locale,
  planbyTheme,
  timelinePanEnabled,
  onSelectReservation,
  onEmptyCellClick,
}: CalendarPlanbyGridProps) {
  const numDays = useMemo(
    () => eachDayOfInterval({ start: startOfDay(dateRange.start), end: startOfDay(dateRange.end) }).length,
    [dateRange],
  );
  const dayWidthPx = (isMobile ? DAY_COLUMN_WIDTH_PX.mobile : DAY_COLUMN_WIDTH_PX.desktop) * numDays;

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
        since: format(addHours(parseLocalCalendarDay(r.checkIn), 12), 'yyyy-MM-dd HH:mm:ss'),
        till: format(addHours(parseLocalCalendarDay(r.checkOut), 12), 'yyyy-MM-dd HH:mm:ss'),
        _reservation: r,
      })),
    [filteredReservations],
  );

  const planbyLayoutKey = useMemo(
    () =>
      filteredReservations
        .map((r) => `${r.uuid}:${r.checkIn}:${r.checkOut}:${r.status}`)
        .sort()
        .join('|'),
    [filteredReservations],
  );

  /** Cover all sidebar rows even if layoutHeight races; ~tens of properties. */
  const itemOverscan = Math.max(ITEM_HEIGHT_PX * 4, channels.length * ITEM_HEIGHT_PX);

  const { getEpgProps, getLayoutProps } = useEpg({
    channels,
    epg,
    startDate: format(startOfDay(dateRange.start), 'yyyy-MM-dd 00:00:00'),
    endDate: format(addDays(startOfDay(dateRange.end), 1), 'yyyy-MM-dd 00:00:00'),
    dayWidth: dayWidthPx,
    sidebarWidth: isMobile ? 56 : 240,
    itemHeight: ITEM_HEIGHT_PX,
    itemOverscan,
    isLine: false,
    isTimeline: true,
    isSidebar: true,
    theme: planbyTheme,
    ...(width != null && width > 0 ? { width } : {}),
    ...(height != null && height > 0 ? { height } : {}),
  });

  const epgProps = getEpgProps();
  const layoutProps = getLayoutProps();
  const {
    hourWidth: layoutHourWidth,
    itemHeight: layoutItemHeight,
    ref: planbyScrollRef,
  } = layoutProps;
  const dayColWidthPx = 24 * layoutHourWidth;

  useCalendarTimelinePan({
    enabled: timelinePanEnabled && dayColWidthPx > 0,
    scrollRef: planbyScrollRef,
    dayColWidthPx,
    dateRange,
    onDateRangeChange,
  });

  usePreservePlanbyScroll(planbyScrollRef, dateRange, planbyLayoutKey || 'empty');

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
      const content = t.closest('[data-testid="content"]') as HTMLElement | null;
      if (!content) return;
      if (dayColWidthPx <= 0 || numDays <= 0) return;

      const contentRect = content.getBoundingClientRect();
      const yInContent = e.clientY - contentRect.top;
      const xInContent = e.clientX - contentRect.left;
      const rowHeight = layoutItemHeight > 0 ? layoutItemHeight : ITEM_HEIGHT_PX;

      const hit = hitTestCalendarCell({
        yInContent,
        xInContent,
        headerHeightPx: 0,
        itemHeightPx: rowHeight,
        dayColWidthPx,
        numDays,
        numRows: filteredProperties.length,
      });
      if (hit.kind !== 'cell') return;

      let propertyId: string | null = null;
      const sidebarItems = el.querySelectorAll('[data-testid="sidebar-item"]');
      for (let i = 0; i < sidebarItems.length; i++) {
        const item = sidebarItems[i];
        if (!(item instanceof HTMLElement)) continue;
        const rect = item.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY < rect.bottom) {
          propertyId = item.getAttribute('data-property-id');
          break;
        }
      }
      if (!propertyId) {
        propertyId = filteredProperties[hit.rowIndex]?.uuid ?? null;
      }
      if (!propertyId) return;

      const rangeStart = startOfDay(dateRange.start);
      const checkIn = format(addDays(rangeStart, hit.dayIndex), 'yyyy-MM-dd');
      const checkOut = format(addDays(rangeStart, hit.dayIndex + 1), 'yyyy-MM-dd');
      const prop = filteredProperties.find((p) => p.uuid === propertyId);
      const linked = Boolean(prop?.zodomusLinked || prop?.zodomusPropertyId?.trim());

      onEmptyCellClick({
        propertyId,
        propertyTitle: prop?.title,
        checkIn,
        checkOut,
        zodomusLinked: linked,
      });
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [
    planbyScrollRef,
    filteredProperties,
    dayColWidthPx,
    numDays,
    dateRange.start,
    layoutItemHeight,
    onEmptyCellClick,
  ]);

  const propertyMetaById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of filteredProperties) {
      map.set(p.uuid, getPropertyMeta(p.uuid, filteredReservations, dateRange));
    }
    return map;
  }, [filteredProperties, filteredReservations, dateRange]);

  const propertiesById = useMemo(() => {
    const map = new Map<string, Property>();
    for (const p of filteredProperties) map.set(p.uuid, p);
    return map;
  }, [filteredProperties]);

  const renderProgram = useCallback(
    (props: {
      program: PlanbyProgramRow;
      isRTL: boolean;
      isBaseTimeFormat: boolean;
    }) => {
      const data = props.program.data as { _reservation?: Reservation };
      const reservation = data._reservation;
      const property = reservation ? propertiesById.get(reservation.propertyId) : undefined;
      return (
        <ProgramBlock
          key={String(props.program.data.id)}
          program={props}
          onSelect={onSelectReservation}
          isMobile={isMobile}
          otaNightlyPrices={property?.otaNightlyPrices}
          otaNightlyPricesFrom={property?.otaNightlyPricesFrom}
          displayCurrencyFallback={property?.otaCurrency ?? property?.currency}
        />
      );
    },
    [onSelectReservation, isMobile, propertiesById],
  );

  const renderChannel = useCallback(
    ({ channel }: { channel: Channel }) => {
      const { top, height: rowHeight } = channel.position;
      return (
        <div
          key={channel.uuid}
          data-testid="sidebar-item"
          data-property-id={channel.uuid}
          className="bg-[#f8fafc] dark:bg-card"
          style={{
            position: 'absolute',
            top,
            height: rowHeight,
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
            meta={propertyMetaById.get(channel.uuid) ?? ''}
            isMobile={isMobile}
          />
        </div>
      );
    },
    [propertyMetaById, isMobile],
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

  const calendarGridCss = useMemo(() => {
    const rowH = layoutItemHeight > 0 ? layoutItemHeight : ITEM_HEIGHT_PX;
    const colW = dayColWidthPx > 0 ? dayColWidthPx : DAY_COLUMN_WIDTH_PX.desktop;
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
  z-index: 18 !important;
}
.dark #cal-${calendarScopeId} .planby [data-testid="sidebar"] {
  background-color: var(--card) !important;
}
#cal-${calendarScopeId} .planby [data-testid="sidebar-item"] {
  box-sizing: border-box;
}
#cal-${calendarScopeId} .planby[data-testid="container"] > div:first-child > div:first-child {
  display: none !important;
}
#cal-${calendarScopeId} .planby [data-testid="calendar-timeline-header"] {
  isolation: isolate;
  z-index: 15 !important;
}
#cal-${calendarScopeId} .planby [data-testid="content"] {
  cursor: grab;
  z-index: 1;
}
#cal-${calendarScopeId} .planby [data-testid="content"]:active {
  cursor: grabbing;
}
#cal-${calendarScopeId} .planby [data-testid="program-item"] {
  cursor: pointer;
  z-index: 5 !important;
}
#cal-${calendarScopeId} .planby {
  height: 100%;
  min-height: 0;
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
  }, [calendarScopeId, dayColWidthPx, layoutItemHeight]);

  return (
    <>
      {/* eslint-disable-next-line react/no-danger -- scoped grid overlay for Planby content */}
      <style dangerouslySetInnerHTML={{ __html: calendarGridCss }} />
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
        <Epg key={planbyLayoutKey || 'empty'} {...epgProps}>
          <Layout
            {...layoutProps}
            /** Bypass Planby sidebar virtualization when layoutHeight races to 0. */
            isChannelVisible={() => true}
            renderProgram={renderProgram}
            renderChannel={renderChannel}
            renderTimeline={renderTimeline}
          />
        </Epg>
      </div>
    </>
  );
}
