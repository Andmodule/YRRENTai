import { apiClient } from './client';

export interface CallSession {
  id: string;
  correlationId: string;
  provider: string;
  providerCallId: string | null;
  direction: 'inbound' | 'outbound';
  status: string;
  toNumber: string | null;
  guestPhone: string | null;
  propertyId: string | null;
  reservationId: string | null;
  language: string | null;
  startedAt: string | null;
  endedAt: string | null;
  summary: string | null;
  handoffStatus: string;
  endedBy: string | null;
  turnCount: number;
  avgTurnLatencyMs: number | null;
  takenOverByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptSegment {
  id: string;
  sessionId: string;
  turnIndex: number;
  role: 'guest' | 'ai' | 'operator';
  content: string;
  language: string | null;
  intent: string | null;
  confidence: number | null;
  kbSources: string[] | null;
  triggeredEscalation: boolean;
  latencyMs: number | null;
  spokenAt: string | null;
  createdAt: string;
}

export interface CallSessionDetail extends CallSession {
  events: Array<{
    id: string;
    type: string;
    payload: Record<string, unknown> | null;
    latencyMs: number | null;
    createdAt: string;
  }>;
  transcriptSegments: TranscriptSegment[];
  handoffs: Array<{
    id: string;
    mode: string;
    status: string;
    reason: string | null;
    escalationReason: string | null;
    acceptedByUserId: string | null;
    requestedAt: string | null;
    acceptedAt: string | null;
  }>;
}

export async function fetchActiveCalls(): Promise<CallSession[]> {
  const res = await apiClient.get<{ data: CallSession[] }>('/voice/sessions/active');
  return res.data.data;
}

export async function fetchCallSession(id: string): Promise<CallSessionDetail> {
  const res = await apiClient.get<{ data: CallSessionDetail }>(`/voice/sessions/${id}`);
  return res.data.data;
}

export async function postOperatorTakeover(sessionId: string): Promise<void> {
  await apiClient.post('/voice/sessions/takeover', { sessionId });
}
