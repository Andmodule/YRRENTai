'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import {
  fetchOverviewStats,
  fetchOverviewTrends,
  fetchSystemHealth,
  fetchPropertyRollout,
  fetchActiveSessions,
  fetchSession,
  fetchSessionHistory,
  fetchQaQueue,
  bulkUpdateQaStatus,
  // Alerts
  fetchAlerts,
  acknowledgeAlert,
  resolveAlert,
  // Rollout
  fetchRolloutDashboard,
  updatePropertyRollout,
  bulkMoveCohort,
  // QA ownership
  assignQaReview,
  bulkAssignQaReviews,
  fetchQaWorkload,
  // Audit
  fetchAuditLog,
  // Readiness
  fetchVoiceReadiness,
  runVoiceSmokeTests,
  bootstrapVoiceDefaults,
} from '@/lib/api/calls-admin';
import type { AlertStatus, AlertSeverity, RolloutCohort } from '@/lib/api/calls-admin';

// ── Query keys ────────────────────────────────────────────────────────────────

export const CALLS_OVERVIEW_KEY = ['calls-overview'];
export const CALLS_ACTIVE_KEY = ['calls-active'];
export const CALLS_QA_KEY = ['calls-qa'];

// ── Badge hook (used by sidebar) ──────────────────────────────────────────────

export function useCallsNavBadge(enabled: boolean): number {
  const { data } = useQuery({
    queryKey: [...CALLS_OVERVIEW_KEY, 'badge'],
    queryFn: () => fetchOverviewStats(),
    enabled,
    refetchInterval: 20_000,
    staleTime: 15_000,
  });
  return (data?.activeSessions ?? 0) + (data?.pendingReviewsCount ?? 0);
}

// ── Overview ──────────────────────────────────────────────────────────────────

export function useOverviewStats(propertyId?: string) {
  return useQuery({
    queryKey: [...CALLS_OVERVIEW_KEY, propertyId],
    queryFn: () => fetchOverviewStats(propertyId),
    refetchInterval: 15_000,
    staleTime: 10_000,
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
    queryKey: ['calls-health', range],
    queryFn: () => fetchSystemHealth(range),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}

export function usePropertyRollout() {
  return useQuery({
    queryKey: ['calls-rollout'],
    queryFn: fetchPropertyRollout,
    staleTime: 30_000,
  });
}

// ── Live sessions ─────────────────────────────────────────────────────────────

export function useActiveSessions() {
  return useQuery({
    queryKey: CALLS_ACTIVE_KEY,
    queryFn: fetchActiveSessions,
    refetchInterval: 8_000,
    staleTime: 5_000,
  });
}

export function useCallSession(id: string | null) {
  return useQuery({
    queryKey: ['calls-session', id],
    queryFn: () => fetchSession(id!),
    enabled: !!id,
    refetchInterval: 10_000,
  });
}

// ── History ───────────────────────────────────────────────────────────────────

export function useSessionHistory(params: Parameters<typeof fetchSessionHistory>[0]) {
  return useQuery({
    queryKey: ['calls-history', params],
    queryFn: () => fetchSessionHistory(params),
    staleTime: 30_000,
  });
}

// ── QA ────────────────────────────────────────────────────────────────────────

export function useQaQueue(params: Parameters<typeof fetchQaQueue>[0]) {
  return useQuery({
    queryKey: [...CALLS_QA_KEY, params],
    queryFn: () => fetchQaQueue(params),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useBulkQaUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: Parameters<typeof bulkUpdateQaStatus>[1] }) =>
      bulkUpdateQaStatus(ids, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CALLS_QA_KEY });
      void qc.invalidateQueries({ queryKey: CALLS_OVERVIEW_KEY });
    },
  });
}

export function useQaAssign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reviewId, assigneeId, dueAt, priority }: {
      reviewId: string; assigneeId: string; dueAt?: string;
      priority?: 'low' | 'normal' | 'high' | 'urgent';
    }) => assignQaReview(reviewId, { assigneeId, dueAt, priority }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CALLS_QA_KEY }),
  });
}

export function useQaBulkAssign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: Parameters<typeof bulkAssignQaReviews>[0]) => bulkAssignQaReviews(dto),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CALLS_QA_KEY }),
  });
}

export function useQaWorkload() {
  return useQuery({
    queryKey: ['calls-qa-workload'],
    queryFn: fetchQaWorkload,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ── Alerts ────────────────────────────────────────────────────────────────────

const CALLS_ALERTS_KEY = ['calls-alerts'];

export function useAlerts(params: { status?: AlertStatus; severity?: AlertSeverity; propertyId?: string } = {}) {
  return useQuery({
    queryKey: [...CALLS_ALERTS_KEY, params],
    queryFn: () => fetchAlerts(params),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}

export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => acknowledgeAlert(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CALLS_ALERTS_KEY }),
  });
}

export function useResolveAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => resolveAlert(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CALLS_ALERTS_KEY });
      void qc.invalidateQueries({ queryKey: CALLS_OVERVIEW_KEY });
    },
  });
}

export function useEvaluateAlerts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (propertyId?: string) =>
      apiClient.post<{ data: { created: number; refreshed: number; recovering: number; autoResolved: number } }>(
        `/voice/alerts/evaluate${propertyId ? `?propertyId=${propertyId}` : ''}`,
        {},
      ).then((r) => r.data.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CALLS_ALERTS_KEY }),
  });
}

// ── Rollout ───────────────────────────────────────────────────────────────────

const CALLS_ROLLOUT_KEY = ['calls-rollout-dashboard'];

export function useRolloutDashboard() {
  return useQuery({
    queryKey: CALLS_ROLLOUT_KEY,
    queryFn: fetchRolloutDashboard,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useUpdateRollout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ propertyId, ...dto }: Parameters<typeof updatePropertyRollout>[1] & { propertyId: string }) =>
      updatePropertyRollout(propertyId, dto),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CALLS_ROLLOUT_KEY }),
  });
}

export function useBulkMoveCohort() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ propertyIds, cohort }: { propertyIds: string[]; cohort: RolloutCohort }) =>
      bulkMoveCohort(propertyIds, cohort),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CALLS_ROLLOUT_KEY }),
  });
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export function useAuditLog(params: Parameters<typeof fetchAuditLog>[0] = {}) {
  return useQuery({
    queryKey: ['calls-audit', params],
    queryFn: () => fetchAuditLog(params),
    staleTime: 30_000,
  });
}

// ── Readiness ─────────────────────────────────────────────────────────────────

const CALLS_READINESS_KEY = ['calls-readiness'];

export function useVoiceReadiness() {
  return useQuery({
    queryKey: CALLS_READINESS_KEY,
    queryFn: fetchVoiceReadiness,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}

export function useRunVoiceSmokeTests() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => runVoiceSmokeTests(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CALLS_READINESS_KEY }),
  });
}

export function useBootstrapVoiceDefaults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ownerId: string) => bootstrapVoiceDefaults(ownerId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CALLS_READINESS_KEY }),
  });
}
