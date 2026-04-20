import { apiClient } from './client';

export type QaFlag =
  | 'low_confidence'
  | 'fallback_triggered'
  | 'unresolved_question'
  | 'emergency_detected'
  | 'complaint_detected'
  | 'transfer_failed'
  | 'long_session'
  | 'kb_miss'
  | 'repeat_guest'
  | 'high_latency';

export type ReviewStatus = 'pending' | 'reviewed' | 'escalated' | 'closed';

export interface CallReview {
  id: string;
  sessionId: string;
  status: ReviewStatus;
  summary: string | null;
  detectedIntents: string[] | null;
  unresolvedQuestions: string[] | null;
  escalationReason: string | null;
  transferOutcome: string | null;
  qaFlags: QaFlag[] | null;
  followUpRequired: boolean;
  followUpSuggestion: string | null;
  kbImprovementHints: Array<{ question: string; suggestedUpdate: string }> | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewerNote: string | null;
  qualityRating: number | null;
  totalTurns: number | null;
  avgTurnLatencyMs: number | null;
  avgConfidence: number | null;
  fallbackCount: number | null;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface WarmTransferBriefing {
  sessionId: string;
  guestPhone: string | null;
  propertyName: string | null;
  propertyAddress: string | null;
  guestName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  lastIntent: string | null;
  escalationReason: string;
  lastAiResponse: string | null;
  turnCount: number;
  avgLatencyMs: number | null;
  transcriptSnippet: string;
}

export async function fetchCallReview(sessionId: string): Promise<CallReview> {
  const res = await apiClient.get<{ data: CallReview }>(`/voice/sessions/${sessionId}/review`);
  return res.data.data;
}

export async function updateCallReview(
  sessionId: string,
  dto: { reviewerNote?: string; qualityRating?: number; status?: ReviewStatus },
): Promise<CallReview> {
  const res = await apiClient.put<{ data: CallReview }>(`/voice/sessions/${sessionId}/review`, dto);
  return res.data.data;
}

export async function fetchBriefing(sessionId: string): Promise<WarmTransferBriefing> {
  const res = await apiClient.get<{ data: WarmTransferBriefing }>(
    `/voice/sessions/${sessionId}/briefing`,
  );
  return res.data.data;
}

export async function fetchCallHistory(params: {
  status?: string;
  hasQaFlag?: string;
  propertyId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ sessions: import('./calls').CallSession[]; total: number }> {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.hasQaFlag) q.set('hasQaFlag', params.hasQaFlag);
  if (params.propertyId) q.set('propertyId', params.propertyId);
  if (params.limit) q.set('limit', String(params.limit));
  if (params.offset) q.set('offset', String(params.offset));
  const res = await apiClient.get<{ data: { sessions: import('./calls').CallSession[]; total: number } }>(
    `/voice/sessions/history?${q.toString()}`,
  );
  return res.data.data;
}
