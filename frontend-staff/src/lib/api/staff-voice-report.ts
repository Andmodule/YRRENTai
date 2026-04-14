import { apiClient } from '@/lib/api/client';

export type StaffMiniAppButtonPressed = 'TASK' | 'INCIDENT';
export type StaffMiniAppDetectedMode = 'TASK_ONLY' | 'INCIDENT_ONLY' | 'MIXED';

export interface StaffVoicePreviewData {
  buttonPressed: StaffMiniAppButtonPressed;
  detectedMode: StaffMiniAppDetectedMode;
  confidence: number;
  transcript: string;
  task: {
    suggestedStatus: string | null;
    comment: string;
    shortages: string | null;
  };
  incident: {
    include: boolean;
    type: string | null;
    title: string | null;
    description: string | null;
    risk: 'low' | 'medium' | 'high' | null;
  };
  needsClarification: boolean;
  clarificationQuestions: string[];
  mismatchHint: string | null;
  overridePropertyId?: string | null;
  overridePropertyTitle?: string | null;
}

export async function postStaffVoicePreview(
  blob: Blob,
  buttonPressed: StaffMiniAppButtonPressed,
  opts: {
    taskUuid?: string;
    propertyId?: string;
    clarificationText?: string;
    language?: string;
  },
): Promise<StaffVoicePreviewData> {
  const form = new FormData();
  const ext = blob.type.includes('mp4') || blob.type.includes('m4a') ? 'm4a' : 'webm';
  form.append('audio', blob, `voice.${ext}`);
  const tid = opts.taskUuid?.trim();
  const pid = opts.propertyId?.trim();
  if (!tid && !pid) {
    throw new Error('taskUuid or propertyId required');
  }
  if (tid && pid) {
    throw new Error('Only one of taskUuid or propertyId');
  }
  if (tid) form.append('taskUuid', tid);
  if (pid) form.append('propertyId', pid);
  form.append('buttonPressed', buttonPressed);
  if (opts.clarificationText?.trim()) {
    form.append('clarificationText', opts.clarificationText.trim());
  }
  if (opts.language?.trim()) {
    form.append('language', opts.language.trim().slice(0, 2));
  }

  const res = await apiClient.post<{ data: StaffVoicePreviewData }>('/tasks/staff-miniapp/voice-preview', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data.data;
}

/** Только STT — для голосового ответа на уточняющие вопросы. */
export async function postStaffVoiceTranscribe(blob: Blob, language?: string): Promise<string> {
  const form = new FormData();
  const ext = blob.type.includes('mp4') || blob.type.includes('m4a') ? 'm4a' : 'webm';
  form.append('audio', blob, `voice.${ext}`);
  if (language?.trim()) {
    form.append('language', language.trim().slice(0, 2));
  }

  const res = await apiClient.post<{ data: { transcript: string } }>(
    '/tasks/staff-miniapp/voice-transcribe',
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
    },
  );
  return (res.data.data.transcript ?? '').trim();
}

export async function postStaffVoiceSubmit(payload: {
  taskUuid?: string;
  propertyId?: string;
  overridePropertyId?: string | null;
  clientRequestId?: string;
  buttonPressed: StaffMiniAppButtonPressed;
  transcript: string;
  detectedMode: StaffMiniAppDetectedMode;
  task: { suggestedStatus: string | null; comment: string; shortages?: string | null };
  incident: {
    include: boolean;
    type?: string | null;
    title?: string | null;
    description?: string | null;
    risk?: string | null;
    photoUrls?: string[];
  };
}): Promise<{ ok: boolean; taskUuid: string }> {
  const res = await apiClient.post<{ data: { ok: boolean; taskUuid: string } }>(
    '/tasks/staff-miniapp/voice-submit',
    payload,
  );
  return res.data.data;
}
