'use client';

import { useQuery } from '@tanstack/react-query';
import {
  fetchOverviewStats,
  fetchPropertyRollout,
  fetchQaQueue,
  fetchOverviewTrends,
  fetchSystemHealth,
} from '@/lib/api/calls-stats';

export const OVERVIEW_STATS_KEY = ['calls-overview-stats'] as const;
export const ROLLOUT_KEY = ['calls-rollout'] as const;
export const QA_QUEUE_KEY = ['calls-qa-queue'] as const;

export function useOverviewStats(propertyId?: string) {
  return useQuery({
    queryKey: [...OVERVIEW_STATS_KEY, propertyId],
    queryFn: () => fetchOverviewStats(propertyId),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}

export function usePropertyRollout() {
  return useQuery({
    queryKey: ROLLOUT_KEY,
    queryFn: fetchPropertyRollout,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useOverviewTrends(range: 'today' | '7d' | '30d' = 'today', propertyId?: string) {
  return useQuery({
    queryKey: ['calls-trends', range, propertyId],
    queryFn: () => fetchOverviewTrends(range, propertyId),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useSystemHealth(range: '24h' | '7d' = '24h') {
  return useQuery({
    queryKey: ['calls-system-health', range],
    queryFn: () => fetchSystemHealth(range),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useQaQueue(params?: {
  status?: string;
  propertyId?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: [...QA_QUEUE_KEY, params],
    queryFn: () => fetchQaQueue(params),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
