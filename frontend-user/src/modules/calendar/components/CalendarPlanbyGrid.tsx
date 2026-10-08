'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Epg, Layout, useEpg } from 'planby';
import type { Channel, Theme } from 'planby';
import type { ProgramItem as PlanbyProgramRow } from 'planby/dist/Epg/helpers/types';
import type { Locale } from 'date-fns';
import { addDays, addHours, eachDayOfInterval, format, startOfDay } from 'date-fns';
import type { CalendarDateRange, Property, Reservation } from '../types';
import { useCalendarTimelinePan } from '../hooks/use-calendar-timeline-pan';
import { getPropertyMeta } from '../lib/property-meta';
import { parseLocalCalendarDay } from '../lib/calendar-api-dates';
import { hitTestCalendarCell } from '../lib/hit-test-calendar-cell';
import { ProgramBlock } from './ProgramBlock';
import { TimelineHeader } from './TimelineHeader';
import { SidebarChannel } from './SidebarChannel';
import type { CalendarPromotion } from '@/modules/pricing/api';
import {
  CalendarPromotionsLayer,
  type CalendarCellPrices,
  type CellRect,
} from '@/modules/pricing/components/calendar/CalendarPromotionsLayer';

/** «Цены → Скидки» on the grid: badges, drag / Shift+click range selection. Omitted when the feature is off. */
export type CalendarPricingProps = {
  promotions: CalendarPromotion[];
  /** Booking nightly prices for free cells. */
  cellPrices?: CalendarCellPrices;
  selection: CellRect | null;
  onSelectionChange: (rect: CellRect | null) => void;
  onBadgeClick: (propertyId: string, ymd: string) => void;
};

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
  pricing?: CalendarPricingProps;
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
  pricing,
}: CalendarPlanbyGridProps) {
  const pricingRef = useRef(pricing);
  pricingRef.current = pricing;
  const dragRef = useRef<{ start: { row: number; day: number }; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const anchorRef = useRef<{ row: number; day: number } | null>(null);
  const [contentEl, setContentEl] = useState<HTMLElement | null>(null);
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
    numDays,
    dateRange,
    onDateRangeChange,
  });

  useEffect(() => {
    if (filteredProperties.length === 0) return;
    const el = planbyScrollRef.current;
    if (!el) return;

    /** Empty grid cell under the pointer (not a booking bar, sidebar, header or pricing badge). */
    const cellAt = (e: MouseEvent): { row: number; day: number; propertyId: string } | null => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-testid="program-item"]')) return null;
      if (t.closest('[data-testid="sidebar"]')) return null;
      if (t.closest('[data-testid="sidebar-item"]')) return null;
      if (t.closest('[data-testid="calendar-timeline-header"]')) return null;
      if (t.closest('[data-pricing-interactive]')) return null;
      const content = t.closest('[data-testid="content"]') as HTMLElement | null;
      if (!content) return null;
      if (dayColWidthPx <= 0 || numDays <= 0) return null;

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
      if (hit.kind !== 'cell') return null;

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
      if (!propertyId) return null;
      const row = filteredProperties.findIndex((p) => p.uuid === propertyId);
      if (row < 0) return null;
      return { row, day: hit.dayIndex, propertyId };
    };

    const rectOf = (a: { row: number; day: number }, b: { row: number; day: number }): CellRect => ({
      r1: Math.min(a.row, b.row),
      r2: Math.max(a.row, b.row),
      d1: Math.min(a.day, b.day),
      d2: Math.max(a.day, b.day),
    });

    // Drag across days / properties → range selection (only when «Цены» is on).
    const onMouseDown = (e: MouseEvent) => {
      suppressClickRef.current = false;
      if (!pricingRef.current || e.button !== 0 || e.shiftKey) return;
      const c = cellAt(e);
      if (!c) return;
      dragRef.current = { start: { row: c.row, day: c.day }, moved: false };
    };
    const onMouseMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d || !pricingRef.current) return;
      if ((e.buttons & 1) === 0) {
        dragRef.current = null;
        return;
      }
      const c = cellAt(e);
      if (!c) return;
      if (!d.moved && c.row === d.start.row && c.day === d.start.day) return;
      d.moved = true;
      e.preventDefault();
      pricingRef.current.onSelectionChange(rectOf(d.start, c));
    };
    const onMouseUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (d?.moved) suppressClickRef.current = true;
    };

    const onClick = (e: MouseEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      const c = cellAt(e);
      if (!c) return;
      const pricingNow = pricingRef.current;
      if (pricingNow && e.shiftKey) {
        // Shift+click starts or extends the range from the last clicked cell, without the actions dialog.
        const from = anchorRef.current ?? { row: c.row, day: c.day };
        anchorRef.current = from;
        pricingNow.onSelectionChange(rectOf(from, c));
        return;
      }
      anchorRef.current = { row: c.row, day: c.day };
      if (pricingNow?.selection) pricingNow.onSelectionChange(null);

      const rangeStart = startOfDay(dateRange.start);
      const checkIn = format(addDays(rangeStart, c.day), 'yyyy-MM-dd');
      const checkOut = format(addDays(rangeStart, c.day + 1), 'yyyy-MM-dd');
      const prop = filteredProperties.find((p) => p.uuid === c.propertyId);
      const linked = Boolean(prop?.zodomusLinked || prop?.zodomusPropertyId?.trim());

      onEmptyCellClick({
        propertyId: c.propertyId,
        propertyTitle: prop?.title,
        checkIn,
        checkOut,
        zodomusLinked: linked,
      });
    };
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('click', onClick);
    };
  }, [
    planbyScrollRef,
    filteredProperties,
    dayColWidthPx,
    numDays,
    dateRange.start,
    layoutItemHeight,
    onEmptyCellClick,
  ]);

  /** Planby remounts its content pane with the layout key; keep the overlay's portal target current. */
  useEffect(() => {
    const next = pricing
      ? (planbyScrollRef.current?.querySelector<HTMLElement>('[data-testid="content"]') ?? null)
      : null;
    if (next !== contentEl) setContentEl(next);
  });

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

  const propertyIds = useMemo(() => filteredProperties.map((p) => p.uuid), [filteredProperties]);
  const firstDayYmd = format(startOfDay(dateRange.start), 'yyyy-MM-dd');

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

  const pricingEnabled = Boolean(pricing);
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
  cursor: crosshair;
  z-index: 1;
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
${
  pricingEnabled
    ? `#cal-${calendarScopeId} .planby [data-testid="content"] {
  user-select: none;
}
`
    : ''
}`;
  }, [calendarScopeId, dayColWidthPx, layoutItemHeight, pricingEnabled]);

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
      {pricing && contentEl
        ? createPortal(
            <CalendarPromotionsLayer
              propertyIds={propertyIds}
              firstDay={firstDayYmd}
              numDays={numDays}
              dayColWidthPx={dayColWidthPx}
              rowHeightPx={layoutItemHeight > 0 ? layoutItemHeight : ITEM_HEIGHT_PX}
              promotions={pricing.promotions}
              cellPrices={pricing.cellPrices}
              selection={pricing.selection}
              onBadgeClick={pricing.onBadgeClick}
            />,
            contentEl,
          )
        : null}
    </>
  );
}
