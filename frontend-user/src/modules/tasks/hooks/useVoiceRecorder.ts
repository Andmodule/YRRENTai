'use client';

import { useCallback, useRef, useState } from 'react';

export type VoiceRecorderStatus =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'stopped'
  | 'denied'
  | 'unsupported';

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/mp4;codecs=aac',
    'audio/ogg;codecs=opus',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

/**
 * Browser microphone capture for voice tasks.
 * getUserMedia must run inside a user gesture on iOS Safari — call `startRecording` from a button click.
 */
export function useVoiceRecorder() {
  const [status, setStatus] = useState<VoiceRecorderStatus>('idle');
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const resetRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state === 'recording') {
      try {
        rec.stop();
      } catch {
        /* noop */
      }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    setStatus('idle');
  }, []);

  const startRecording = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!window.isSecureContext && window.location.hostname !== 'localhost') {
      setStatus('unsupported');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setStatus('unsupported');
      return;
    }

    setStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = pickMimeType();
      let recorder: MediaRecorder;
      try {
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      } catch {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setStatus('unsupported');
        return;
      }
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(250);
      setStatus('recording');
    } catch (e) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      chunksRef.current = [];
      if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError')) {
        setStatus('denied');
      } else {
        setStatus('denied');
      }
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    const stream = streamRef.current;
    if (!recorder || recorder.state === 'inactive') {
      resetRecording();
      return null;
    }
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const type = recorder.mimeType || pickMimeType() || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        stream?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        chunksRef.current = [];
        setStatus('stopped');
        resolve(blob.size > 0 ? blob : null);
      };
      try {
        recorder.stop();
      } catch {
        resetRecording();
        resolve(null);
      }
    });
  }, [resetRecording]);

  return {
    status,
    isRecording: status === 'recording',
    startRecording,
    stopRecording,
    resetRecording,
  };
}
