'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceRecorderStatus =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'stopped'
  | 'denied'
  | 'unsupported';

export type VoiceRecorderAutoStopReason = 'max_duration' | 'silence';

export type VoiceAutoStopPayload = {
  reason: VoiceRecorderAutoStopReason;
  blob: Blob | null;
};

const MAX_RECORDING_MS = 5 * 60 * 1000;
const SILENCE_MS = 60 * 1000;
const SILENCE_CHECK_INTERVAL_MS = 200;
const RMS_THRESHOLD = 0.02;

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isApple =
    /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && (navigator as Navigator).maxTouchPoints > 1);
  const candidates = isApple
    ? [
        'audio/mp4;codecs=aac',
        'audio/mp4',
        'audio/aac',
        'audio/webm',
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
      ]
    : [
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

function createMediaRecorder(stream: MediaStream): MediaRecorder | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const mimeType = pickMimeType();
  if (mimeType) {
    try {
      return new MediaRecorder(stream, { mimeType });
    } catch {
      /* fall through */
    }
  }
  try {
    return new MediaRecorder(stream);
  } catch {
    return null;
  }
}

async function getUserMediaWithFallback(): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
    },
  };
  try {
    return await navigator.mediaDevices!.getUserMedia(constraints);
  } catch {
    return await navigator.mediaDevices!.getUserMedia({ audio: true });
  }
}

/**
 * Как во frontend-user SmartCreateSheet: явное «Завершить» снизу + авто-стоп по тишине/лимиту времени.
 */
export function useVoiceRecorder(options?: {
  onAutoStop?: (payload: VoiceAutoStopPayload) => void;
}) {
  const onAutoStop = options?.onAutoStop;
  const [status, setStatus] = useState<VoiceRecorderStatus>('idle');
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const lastNonSilentAtRef = useRef<number>(0);
  const autoStopFiredRef = useRef(false);

  const cleanupMonitoring = useCallback(() => {
    if (maxDurationTimerRef.current != null) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
    if (silenceIntervalRef.current != null) {
      clearInterval(silenceIntervalRef.current);
      silenceIntervalRef.current = null;
    }
    try {
      sourceNodeRef.current?.disconnect();
    } catch {
      /* noop */
    }
    sourceNodeRef.current = null;
    analyserRef.current = null;
    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    if (ctx && ctx.state !== 'closed') {
      void ctx.close();
    }
  }, []);

  const stopRecordingImpl = useCallback(
    async (autoStopReason?: VoiceRecorderAutoStopReason): Promise<Blob | null> => {
      cleanupMonitoring();
      const recorder = recorderRef.current;
      const stream = streamRef.current;
      if (!recorder || recorder.state === 'inactive') {
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
          const out = blob.size > 0 ? blob : null;
          if (autoStopReason) {
            onAutoStop?.({ reason: autoStopReason, blob: out });
          }
          resolve(out);
        };
        try {
          recorder.stop();
        } catch {
          stream?.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          recorderRef.current = null;
          chunksRef.current = [];
          setStatus('idle');
          resolve(null);
        }
      });
    },
    [cleanupMonitoring, onAutoStop],
  );

  const stopRecordingImplRef = useRef(stopRecordingImpl);
  useEffect(() => {
    stopRecordingImplRef.current = stopRecordingImpl;
  }, [stopRecordingImpl]);

  const resetRecording = useCallback(() => {
    cleanupMonitoring();
    autoStopFiredRef.current = false;
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
  }, [cleanupMonitoring]);

  const startAudioMonitoring = useCallback(
    (stream: MediaStream) => {
      cleanupMonitoring();
      lastNonSilentAtRef.current = Date.now();
      autoStopFiredRef.current = false;

      const AudioContextCtor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        maxDurationTimerRef.current = setTimeout(() => {
          if (autoStopFiredRef.current) return;
          autoStopFiredRef.current = true;
          void stopRecordingImplRef.current?.('max_duration');
        }, MAX_RECORDING_MS);
        return;
      }

      const ctx = new AudioContextCtor();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.3;
      analyserRef.current = analyser;
      source.connect(analyser);

      void ctx.resume().catch(() => {});

      maxDurationTimerRef.current = setTimeout(() => {
        if (autoStopFiredRef.current) return;
        autoStopFiredRef.current = true;
        void stopRecordingImplRef.current?.('max_duration');
      }, MAX_RECORDING_MS);

      silenceIntervalRef.current = setInterval(() => {
        if (autoStopFiredRef.current) return;
        const analyserNode = analyserRef.current;
        if (!analyserNode) return;
        const buf = new Float32Array(analyserNode.fftSize);
        analyserNode.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const s = buf[i] ?? 0;
          sum += s * s;
        }
        const rms = Math.sqrt(sum / buf.length);
        const now = Date.now();
        if (rms > RMS_THRESHOLD) {
          lastNonSilentAtRef.current = now;
        } else if (now - lastNonSilentAtRef.current >= SILENCE_MS) {
          autoStopFiredRef.current = true;
          void stopRecordingImplRef.current?.('silence');
        }
      }, SILENCE_CHECK_INTERVAL_MS);
    },
    [cleanupMonitoring],
  );

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
      const stream = await getUserMediaWithFallback();
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = createMediaRecorder(stream);
      if (!recorder) {
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
      startAudioMonitoring(stream);
    } catch {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      chunksRef.current = [];
      cleanupMonitoring();
      setStatus('denied');
    }
  }, [cleanupMonitoring, startAudioMonitoring]);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    autoStopFiredRef.current = true;
    return stopRecordingImpl();
  }, [stopRecordingImpl]);

  return {
    status,
    isRecording: status === 'recording',
    startRecording,
    stopRecording,
    resetRecording,
  };
}
