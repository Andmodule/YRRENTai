import { apiClient } from './client';

export interface TrendPoint {
  ts: string;
  callsCompleted: number;
  escalationRate: number;
  handoffRate: number;
  fallbackRate: number;
  lowConfidenceRate: number;
  p50TurnLatencyMs: number | null;
  p95TurnLatencyMs: number | null;
}

export interface OverviewTrends {
  range: 'today' | '7d' | '30d';
  bucketSize: 'hour' | 'day';
  points: TrendPoint[];
}

export interface SystemHealth {
  range: '24h' | '7d';
  webhookFailureCount: number;
  structuredOutputFailureCount: number;
  duplicateEventCount: number;
  kbMissRate: number;
  emergencyGuardTriggers: number;
  failedTransfersLast24h: number;
  activeSessionsByProvider: Record<string, number>;
}

export interface OverviewStats {
  activeSessions: number;
  callsToday: number;
  escalatedPct: number;
  handoffPct: number;
  fallbackPct: number;
  lowConfidencePct: number;
  p50TurnLatencyMs: number | null;
  p95TurnLatencyMs: number | null;
  pendingReviewsCount: number;
  recentEscalations: RecentAlert[];
  recentFailedTransfers: RecentAlert[];
}

export interface RecentAlert {
  sessionId: string;
  guestPhone: string | null;
  propertyId: string | null;
  reason: string | null;
  occurredAt: string;
}

export interface PropertyRolloutItem {
  propertyId: string;
  propertyName: string | null;
  enabled: boolean;
  provider: string;
  callsLast7d: number;
  fallbackRate: number | null;
  lastIssue: string | null;
}

export interface QaQueueItem {
  sessionId: string;
  reviewId: string;
  status: string;
  guestPhone: string | null;
  propertyId: string | null;
  qaFlags: string[] | null;
  followUpRequired: boolean;
  escalationReason: string | null;
  totalTurns: number | null;
  durationSeconds: number | null;
  createdAt: string;
}

export async function fetchOverviewStats(propertyId?: string): Promise<OverviewStats> {
  const q = propertyId ? `?propertyId=${propertyId}` : '';
  const res = await apiClient.get<{ data: OverviewStats }>(`/voice/stats/overview${q}`);
  return res.data.data;
}

export async function fetchPropertyRollout(): Promise<PropertyRolloutItem[]> {
  const res = await apiClient.get<{ data: PropertyRolloutItem[] }>('/voice/stats/rollout');
  return res.data.data;
}

export async function fetchQaQueue(params?: {
  status?: string;
  reviewStatus?: string;
  hasQaFlag?: string;
  propertyId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: QaQueueItem[]; total: number }> {
  const q = new URLSearchParams();
  const effectiveStatus = params?.reviewStatus ?? params?.status;
  if (effectiveStatus) q.set('reviewStatus', effectiveStatus);
  if (params?.hasQaFlag) q.set('hasQaFlag', params.hasQaFlag);
  if (params?.propertyId) q.set('propertyId', params.propertyId);
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.offset) q.set('offset', String(params.offset));
  const res = await apiClient.get<{ data: { items: QaQueueItem[]; total: number } }>(
    `/voice/qa/queue?${q.toString()}`,
  );
  return res.data.data;
}

export async function bulkUpdateQa(
  sessionIds: string[],
  status: 'open' | 'in_review' | 'resolved' | 'escalated' | 'closed',
): Promise<{ updated: number; errors: string[] }> {
  const res = await apiClient.patch<{ data: { updated: number; errors: string[] } }>(
    '/voice/qa/bulk',
    { sessionIds, status },
  );
  return res.data.data;
}

export async function fetchOverviewTrends(
  range: 'today' | '7d' | '30d' = 'today',
  propertyId?: string,
): Promise<OverviewTrends> {
  const q = new URLSearchParams({ range });
  if (propertyId) q.set('propertyId', propertyId);
  const res = await apiClient.get<{ data: OverviewTrends }>(`/voice/stats/overview-trends?${q}`);
  return res.data.data;
}

export async function fetchSystemHealth(range: '24h' | '7d' = '24h'): Promise<SystemHealth> {
  const res = await apiClient.get<{ data: SystemHealth }>(
    `/voice/stats/system-health?range=${range}`,
  );
  return res.data.data;
}

export function buildExportUrl(
  type: 'history' | 'qa',
  params: Record<string, string | undefined>,
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) q.set(k, v);
  }
  const path = type === 'qa' ? '/voice/qa/export' : '/voice/sessions/history/export';
  return `${path}?${q.toString()}`;
}
