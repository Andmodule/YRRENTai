'use client';

import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { apiClient } from '@/lib/api/client';
import type { CalendarDateRange, Property, Reservation } from '../types';

interface CalendarApiResponse {
  properties: Property[];
  reservations: Reservation[];
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
      if (body && typeof body === 'object' && 'properties' in body && Array.isArray(body.properties)) {
        return body as CalendarApiResponse;
      }
      if (body && typeof body === 'object' && 'data' in body && body.data && 'properties' in body.data) {
        return body.data as CalendarApiResponse;
      }
      return { properties: [], reservations: [] };
    },
    /** OTA/webhook меняют брони без действия в UI — без интервала данные «застывают» на минуту+. */
    staleTime: 12_000,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}
