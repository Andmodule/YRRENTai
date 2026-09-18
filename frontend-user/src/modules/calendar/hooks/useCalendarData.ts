'use client';

import { useQuery } from '@tanstack/react-query';
import { addDays, format, parseISO } from 'date-fns';
import { apiClient } from '@/lib/api/client';
import type { CalendarDateRange, Property, Reservation } from '../types';

interface CalendarApiResponse {
  properties: Property[];
  reservations: Reservation[];
}

/** Merge consecutive yyyy-MM-dd nights into [checkIn, checkOutExclusive) ranges. */
function mergeBlockedDaysToRanges(days: string[]): Array<{ checkIn: string; checkOut: string }> {
  const sorted = [...new Set(days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  const first = sorted[0];
  if (first === undefined) return [];
  const nextDay = (ymd: string): string =>
    format(addDays(parseISO(`${ymd}T12:00:00.000Z`), 1), 'yyyy-MM-dd');
  const ranges: Array<{ checkIn: string; checkOut: string }> = [];
  let start = first;
  let prev = first;
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cur === undefined) continue;
    if (cur === nextDay(prev)) {
      prev = cur;
      continue;
    }
    ranges.push({ checkIn: start, checkOut: nextDay(prev) });
    start = cur;
    prev = cur;
  }
  ranges.push({ checkIn: start, checkOut: nextDay(prev) });
  return ranges;
}

/**
 * Merge channel-closed nights as synthetic blocked bars.
 * Consecutive nights are coalesced into one bar so Planby shows a clear occupied range.
 */
function withOtaBlockedBars(data: CalendarApiResponse): CalendarApiResponse {
  const extras: Reservation[] = [];
  for (const p of data.properties) {
    const ranges = mergeBlockedDaysToRanges(p.otaBlockedDays ?? []);
    for (const range of ranges) {
      extras.push({
        uuid: `ota-block-${p.uuid}-${range.checkIn}-${range.checkOut}`,
        externalId: `ota-block-${range.checkIn}`,
        fromOta: true,
        otaInventoryBlock: true,
        propertyId: p.uuid,
        guestName: 'OTA',
        guestEmail: null,
        guestPhone: null,
        guestsCount: null,
        guestsAdults: null,
        guestsChildren: null,
        notes: null,
        internalNotes: null,
        paymentStatus: 'unpaid',
        otaPaymentHint: null,
        directSource: null,
        /** Keep visible when channel filter is Booking; also ok under "all". */
        channel: 'booking',
        status: 'blocked',
        totalPrice: 0,
        currency: 'EUR',
        checkIn: range.checkIn,
        checkOut: range.checkOut,
        chatThreadId: null,
        overbookingConflict: false,
        overbookingConflictWithBookingId: null,
      });
    }
  }
  if (extras.length === 0) return data;
  return { properties: data.properties, reservations: [...data.reservations, ...extras] };
}

export function useCalendarData(dateRange: CalendarDateRange) {
  const from = format(dateRange.start, 'yyyy-MM-dd');
  const to = format(dateRange.end, 'yyyy-MM-dd');

  return useQuery({
    queryKey: ['calendar', from, to],
    queryFn: async (): Promise<CalendarApiResponse> => {
      const res = await apiClient.get<{ data: CalendarApiResponse } | CalendarApiResponse>('/calendar', {
        params: { from, to },
      });
      const body = res.data;
      let raw: CalendarApiResponse = { properties: [], reservations: [] };
      if (body && typeof body === 'object' && 'properties' in body && Array.isArray(body.properties)) {
        raw = body as CalendarApiResponse;
      } else if (body && typeof body === 'object' && 'data' in body && body.data && 'properties' in body.data) {
        raw = body.data as CalendarApiResponse;
      }
      return withOtaBlockedBars(raw);
    },
    /**
     * WS (`CalendarSocketProvider`) is the primary invalidation path.
     * Keep a slow poll only as fallback when the socket drops / another origin blocks WS.
     */
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}
