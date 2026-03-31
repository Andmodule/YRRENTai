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
      const res = await apiClient.get<CalendarApiResponse>('/calendar', {
        params: { from, to },
      });
      return res.data;
    },
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}
