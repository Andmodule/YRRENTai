'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchActiveCalls, fetchCallSession } from '@/lib/api/calls';

export const ACTIVE_CALLS_QUERY_KEY = ['calls', 'active'] as const;
export const callSessionKey = (id: string) => ['calls', 'session', id] as const;

export function useActiveCalls(enabled = true) {
  return useQuery({
    queryKey: ACTIVE_CALLS_QUERY_KEY,
    queryFn: fetchActiveCalls,
    enabled,
    staleTime: 15_000,
    /** Socket-first: invalidations keep this fresh. 60s is backup recovery only. */
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useCallSession(id: string | null) {
  return useQuery({
    queryKey: callSessionKey(id ?? ''),
    queryFn: () => fetchCallSession(id!),
    enabled: Boolean(id),
    staleTime: 5_000,
  });
}
