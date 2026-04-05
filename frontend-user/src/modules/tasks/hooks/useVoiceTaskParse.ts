'use client';

import { apiClient } from '@/lib/api/client';
import type { VoiceParseResult } from '../types';

/**
 * Sends recorded audio to Nest: Whisper STT + LLM extraction.
 */
export async function parseVoiceTaskAudio(
  blob: Blob,
  contextPropertyId?: string | null,
  /** ISO 639-1 (e.g. ru, en) — passed to Whisper as `language` to skip detection. */
  language?: string | null,
): Promise<VoiceParseResult> {
  const form = new FormData();
  const ext = blob.type.includes('mp4') || blob.type.includes('m4a') ? 'm4a' : 'webm';
  form.append('audio', blob, `voice.${ext}`);
  if (contextPropertyId?.trim()) {
    form.append('contextPropertyId', contextPropertyId.trim());
  }
  const lang = language?.trim().slice(0, 2);
  if (lang) {
    form.append('language', lang);
  }

  const res = await apiClient.post<{ data: VoiceParseResult }>('/tasks/voice-parse', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data.data;
}
