'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import type { Reservation } from '../types';

const DEBOUNCE_MS = 300;
const MIN_LEN = 2;

function parseReservationSearchResponse(body: unknown): Reservation[] {
  if (body && typeof body === 'object' && 'reservations' in body && Array.isArray((body as { reservations: Reservation[] }).reservations)) {
    return (body as { reservations: Reservation[] }).reservations;
  }
  if (
    body &&
    typeof body === 'object' &&
    'data' in body &&
    body.data &&
    typeof body.data === 'object' &&
    'reservations' in body.data &&
    Array.isArray((body.data as { reservations: Reservation[] }).reservations)
  ) {
    return (body.data as { reservations: Reservation[] }).reservations;
  }
  return [];
}

/**
 * Full-calendar booking search (not limited to the visible date range).
 * Used together with windowed `/calendar` data for filters and search suggestions.
 */
export function useCalendarReservationSearch(activeQuery: string) {
  const trimmed = activeQuery.trim();
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    if (trimmed.length < MIN_LEN) {
      setDebouncedQuery('');
      return;
    }
    const id = window.setTimeout(() => setDebouncedQuery(trimmed), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [trimmed]);

  const query = useQuery({
    queryKey: ['calendar', 'reservation-search', debouncedQuery],
    queryFn: async (): Promise<Reservation[]> => {
      const res = await apiClient.get<unknown>('/calendar/reservation-search', {
        params: { q: debouncedQuery },
      });
      return parseReservationSearchResponse(res.data);
    },
    enabled: debouncedQuery.length >= MIN_LEN,
    staleTime: 12_000,
    refetchInterval: 25_000,
    refetchOnWindowFocus: true,
  });

  return { ...query, debouncedQuery };
}
