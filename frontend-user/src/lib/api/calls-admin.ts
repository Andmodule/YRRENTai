import { apiClient } from './client';

// ── Shared types (mirror backend voice-stats.service interfaces) ─────────────

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

export interface SessionHistoryItem {
  id: string;
  status: string;
  direction: string;
  provider: string;
  guestPhone: string | null;
  propertyId: string | null;
  handoffStatus: string;
  turnCount: number;
  avgTurnLatencyMs: number | null;
  language: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  /** Present when API returns post-call summary */
  summary?: string | null;
}

export interface CallSession extends SessionHistoryItem {
  transcript?: TranscriptSegment[];
  events?: CallEvent[];
}

export interface TranscriptSegment {
  id: string;
  role: 'ai' | 'guest';
  content: string;
  confidence: number | null;
  turnTotalMs: number | null;
  spokenAt: string;
}

export interface CallEvent {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  latencyMs: number | null;
  createdAt: string;
}

// ── API functions ─────────────────────────────────────────────────────────────

export async function fetchOverviewStats(propertyId?: string): Promise<OverviewStats> {
  const q = propertyId ? `?propertyId=${propertyId}` : '';
  const res = await apiClient.get<{ data: OverviewStats }>(`/voice/stats/overview${q}`);
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
  const res = await apiClient.get<{ data: SystemHealth }>(`/voice/stats/system-health?range=${range}`);
  return res.data.data;
}

export async function fetchPropertyRollout(): Promise<PropertyRolloutItem[]> {
  const res = await apiClient.get<{ data: PropertyRolloutItem[] }>('/voice/stats/rollout');
  return res.data.data;
}

export async function fetchActiveSessions(): Promise<CallSession[]> {
  const res = await apiClient.get<{ data: CallSession[] }>('/voice/sessions/active');
  return res.data.data;
}

export async function fetchSession(id: string): Promise<CallSession> {
  const res = await apiClient.get<{ data: CallSession }>(`/voice/sessions/${id}`);
  return res.data.data;
}

export async function fetchSessionHistory(params: {
  status?: string;
  handoffStatus?: string;
  hasQaFlag?: string;
  propertyId?: string;
  provider?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ sessions: SessionHistoryItem[]; total: number }> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, String(v));
  }
  const res = await apiClient.get<{ data: { sessions: SessionHistoryItem[]; total: number } }>(
    `/voice/sessions/history?${q}`,
  );
  return res.data.data;
}

export async function fetchQaQueue(params: {
  reviewStatus?: string;
  hasQaFlag?: string;
  propertyId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: QaQueueItem[]; total: number }> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, String(v));
  }
  const res = await apiClient.get<{ data: { items: QaQueueItem[]; total: number } }>(
    `/voice/qa/queue?${q}`,
  );
  return res.data.data;
}

export async function bulkUpdateQaStatus(
  sessionIds: string[],
  status: 'open' | 'in_review' | 'resolved' | 'escalated' | 'closed',
): Promise<{ updated: number; errors: string[] }> {
  const res = await apiClient.patch<{ data: { updated: number; errors: string[] } }>(
    '/voice/qa/bulk',
    { sessionIds, status },
  );
  return res.data.data;
}

export async function takeoverSession(sessionId: string): Promise<void> {
  await apiClient.post('/voice/sessions/takeover', { sessionId });
}

export function buildExportUrl(type: 'history' | 'qa', params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) q.set(k, v);
  }
  const path = type === 'qa' ? '/voice/qa/export' : '/voice/sessions/history/export';
  return `/api/v1${path}?${q}`;
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'warning' | 'critical';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved';
export type AlertMetricKey =
  | 'fallbackRate' | 'escalationRate' | 'lowConfidenceRate' | 'p95LatencyMs'
  | 'webhookFailures24h' | 'failedTransfers24h' | 'emergencyTriggers24h';

export interface VoiceAlertRule {
  id: string;
  ownerId: string;
  propertyId: string | null;
  provider: string | null;
  metricKey: AlertMetricKey;
  warningThreshold: number | null;
  criticalThreshold: number | null;
  comparator: 'gt' | 'gte';
  windowMinutes: number;
  enabled: boolean;
  createdAt: string;
}

export interface VoiceAlert {
  id: string;
  ruleId: string;
  severity: AlertSeverity;
  metricKey: AlertMetricKey;
  currentValue: number;
  thresholdValue: number;
  propertyId: string | null;
  provider: string | null;
  status: AlertStatus;
  firstTriggeredAt: string;
  lastTriggeredAt: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  rule?: VoiceAlertRule;
}

export async function fetchAlerts(params: {
  status?: AlertStatus;
  severity?: AlertSeverity;
  propertyId?: string;
} = {}): Promise<VoiceAlert[]> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) q.set(k, v);
  }
  const res = await apiClient.get<{ data: VoiceAlert[] }>(`/voice/alerts?${q}`);
  return res.data.data;
}

export async function acknowledgeAlert(id: string): Promise<VoiceAlert> {
  const res = await apiClient.patch<{ data: VoiceAlert }>(`/voice/alerts/${id}/ack`, {});
  return res.data.data;
}

export async function resolveAlert(id: string): Promise<VoiceAlert> {
  const res = await apiClient.patch<{ data: VoiceAlert }>(`/voice/alerts/${id}/resolve`, {});
  return res.data.data;
}

export async function upsertAlertRule(dto: {
  ownerId: string;
  propertyId?: string;
  metricKey: AlertMetricKey;
  warningThreshold?: number;
  criticalThreshold?: number;
  enabled?: boolean;
}): Promise<VoiceAlertRule> {
  const res = await apiClient.post<{ data: VoiceAlertRule }>('/voice/alerts/rules', dto);
  return res.data.data;
}

// ── Rollout ───────────────────────────────────────────────────────────────────

export type RolloutCohort = 'disabled' | 'pilot' | 'beta' | 'stable';

export interface RolloutDashboardProperty {
  propertyId: string;
  propertyName: string | null;
  cohort: RolloutCohort;
  enabled: boolean;
  provider: string;
  callsLast7d: number;
  fallbackRate: number | null;
  activeAlertsCount: number;
  lastCallAt: string | null;
  warningState: string[];
}

export interface RolloutDashboard {
  summary: {
    byCohort: Record<RolloutCohort, number>;
    byProvider: Record<string, number>;
    totalEnabled: number;
    totalDisabled: number;
  };
  properties: RolloutDashboardProperty[];
}

export async function fetchRolloutDashboard(): Promise<RolloutDashboard> {
  const res = await apiClient.get<{ data: RolloutDashboard }>('/voice/rollout/dashboard');
  return res.data.data;
}

export async function updatePropertyRollout(propertyId: string, dto: {
  cohort?: RolloutCohort;
  enabled?: boolean;
  provider?: string;
  confidenceThresholdOverride?: number | null;
  notes?: string | null;
}): Promise<void> {
  await apiClient.patch(`/voice/rollout/${propertyId}`, dto);
}

export async function bulkMoveCohort(propertyIds: string[], cohort: RolloutCohort): Promise<{ moved: number }> {
  const res = await apiClient.patch<{ data: { moved: number } }>('/voice/rollout/bulk-cohort', { propertyIds, cohort });
  return res.data.data;
}

// ── QA Ownership ──────────────────────────────────────────────────────────────

export interface QaWorkloadRow {
  assigneeId: string;
  openCount: number;
  inReviewCount: number;
  escalatedCount: number;
  overdueCount: number;
}

export async function assignQaReview(reviewId: string, dto: {
  assigneeId: string;
  dueAt?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}): Promise<void> {
  await apiClient.patch(`/voice/qa/${reviewId}/assign`, dto);
}

export async function bulkAssignQaReviews(dto: {
  reviewIds: string[];
  assigneeId: string;
  dueAt?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}): Promise<{ updated: number }> {
  const res = await apiClient.patch<{ data: { updated: number } }>('/voice/qa/bulk-assign', dto);
  return res.data.data;
}

export async function fetchQaWorkload(): Promise<QaWorkloadRow[]> {
  const res = await apiClient.get<{ data: QaWorkloadRow[] }>('/voice/qa/workload');
  return res.data.data;
}

// ── Audit log ─────────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorRole: string;
  actionType: string;
  entityType: string | null;
  entityId: string | null;
  propertyId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ── Go-live readiness ─────────────────────────────────────────────────────────

export type CheckStatus = 'pass' | 'warn' | 'fail';
export type ReadinessStatus = 'ready' | 'warning' | 'blocked';

export interface ReadinessCheck {
  key: string;
  label: string;
  status: CheckStatus;
  message: string;
  details?: string;
}

export interface GoLiveReadiness {
  overallStatus: ReadinessStatus;
  checkedAt: string;
  checks: ReadinessCheck[];
  env: {
    provider: string;
    requiredKeysPresent: boolean;
    missingKeys: string[];
    voiceFeatureFlagEnabled: boolean;
  };
  provider: {
    configured: boolean;
    mode: string;
    inboundEnabled: boolean;
  };
  webhook: {
    urlConfigured: boolean;
    signingSecretPresent: boolean;
  };
  handoff: {
    transferNumberPresent: boolean;
    didMapPresent: boolean;
  };
  rollout: {
    enabledPropertiesCount: number;
    pilotCount: number;
    betaCount: number;
    stableCount: number;
    disabledCount: number;
  };
  alerts: {
    activeRuleCount: number;
    hasDefaultCriticalCoverage: boolean;
  };
  qa: {
    pendingReviewsCount: number;
    assignedOpenReviewsCount: number;
    unassignedOpenReviewsCount: number;
  };
}

export type SmokeTestStatus = 'pass' | 'partial' | 'fail';

export interface SmokeTestResult {
  key: string;
  label: string;
  status: 'pass' | 'fail';
  message: string;
  durationMs: number;
}

export interface SmokeTestReport {
  startedAt: string;
  finishedAt: string;
  status: SmokeTestStatus;
  tests: SmokeTestResult[];
}

export async function fetchVoiceReadiness(): Promise<GoLiveReadiness> {
  const res = await apiClient.get<{ data: GoLiveReadiness }>('/voice/readiness');
  return res.data.data;
}

export async function runVoiceSmokeTests(): Promise<SmokeTestReport> {
  const res = await apiClient.post<{ data: SmokeTestReport }>('/voice/readiness/smoke-test', {});
  return res.data.data;
}

export async function bootstrapVoiceDefaults(ownerId: string): Promise<{ alertRulesCreated: number; message: string }> {
  const res = await apiClient.post<{ data: { alertRulesCreated: number; message: string } }>(
    '/voice/readiness/bootstrap', { ownerId },
  );
  return res.data.data;
}

export async function fetchAuditLog(params: {
  actionType?: string;
  actorId?: string;
  propertyId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ items: AuditLogEntry[]; total: number }> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) q.set(k, String(v));
  }
  const res = await apiClient.get<{ data: { items: AuditLogEntry[]; total: number } }>(`/voice/audit-log?${q}`);
  return res.data.data;
}
