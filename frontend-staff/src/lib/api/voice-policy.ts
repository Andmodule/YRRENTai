import { apiClient } from './client';

export interface VoicePolicy {
  // privacy fields
  transcriptRetentionDays?: number;
  redactionEnabled?: boolean;
  exportAllowed?: boolean;
  recordingStorageEnabled?: boolean;
  recordingRetentionDays?: number;
  // topics
  allowedTopics?: string | null;
  escalationTopics?: string | null;
  id: string;
  propertyId: string;
  voiceAssistantEnabled: boolean;
  autoAnswerEnabled: boolean;
  recordCallsEnabled: boolean;
  clarifyThreshold: number;
  escalateThreshold: number;
  maxTurns: number;
  fallbackTransferNumber: string | null;
  afterHoursMode: 'voicemail' | 'transfer' | 'short_ai' | 'reject';
  quietHoursStart: number;
  quietHoursEnd: number;
  emergencyEscalationEnabled: boolean;
  complaintAutoEscalate: boolean;
  preferredLanguages: string;
  shortAnswerMode: boolean;
  updatedAt: string;
}

export async function fetchVoicePolicy(propertyId: string): Promise<VoicePolicy> {
  const res = await apiClient.get<{ data: VoicePolicy }>(`/voice/policy/${propertyId}`);
  return res.data.data;
}

export async function upsertVoicePolicy(
  propertyId: string,
  dto: Partial<VoicePolicy>,
): Promise<VoicePolicy> {
  const res = await apiClient.put<{ data: VoicePolicy }>(`/voice/policy/${propertyId}`, dto);
  return res.data.data;
}

/** Alias for generic partial patch — used by rollout controls */
export async function saveVoicePolicy(
  propertyId: string,
  patch: Record<string, unknown>,
): Promise<VoicePolicy> {
  return upsertVoicePolicy(propertyId, patch as Partial<VoicePolicy>);
}
