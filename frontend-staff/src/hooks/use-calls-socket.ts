'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { io, Socket } from 'socket.io-client';
import { apiClient } from '@/lib/api/client';
import { resolveSocketBaseUrl } from '@/lib/socket/resolve-socket-base-url';
import { ACTIVE_CALLS_QUERY_KEY, callSessionKey } from './use-calls';
import type { TranscriptSegment } from '@/lib/api/calls';

async function fetchWsToken(): Promise<string> {
  const res = await apiClient.post<{ data: { token: string } }>('/auth/ws-token', {});
  return res.data.data.token;
}

export type LiveTranscriptSegment = TranscriptSegment & { live: boolean };

interface UseCallsSocketOptions {
  activeSessionId?: string | null;
  onSegment?: (segment: LiveTranscriptSegment) => void;
  onEscalation?: (payload: {
    sessionId: string;
    reason: string;
    recommendedAction: string;
  }) => void;
}

export function useCallsSocket(options: UseCallsSocketOptions = {}) {
  const { activeSessionId, onSegment, onEscalation } = options;
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const sessionIdRef = useRef<string | null | undefined>(activeSessionId);

  useEffect(() => {
    sessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const joinSession = useCallback((id: string) => {
    socketRef.current?.emit('call:join', { sessionId: id });
  }, []);

  const leaveSession = useCallback((id: string) => {
    socketRef.current?.emit('call:leave', { sessionId: id });
  }, []);

  const takeover = useCallback((id: string) => {
    socketRef.current?.emit('call:takeover', { sessionId: id });
  }, []);

  useEffect(() => {
    const base = resolveSocketBaseUrl();

    const socket = io(`${base}/calls`, {
      path: '/api/socket.io',
      withCredentials: true,
      auth: (cb) => {
        fetchWsToken()
          .then((t) => cb({ token: t }))
          .catch(() => cb({ token: '' }));
      },
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      // Immediately join the active session room on (re)connect
      if (sessionIdRef.current) {
        socket.emit('call:join', { sessionId: sessionIdRef.current });
      }
      // Invalidate the full active-calls list on reconnect (socket-first refresh)
      void queryClient.invalidateQueries({ queryKey: ACTIVE_CALLS_QUERY_KEY });
    });

    // ── Socket-first: new call appears without waiting for polling cycle ────
    socket.on('call.created', (data: { sessionId: string }) => {
      void queryClient.invalidateQueries({ queryKey: ACTIVE_CALLS_QUERY_KEY });
      toast.info('Входящий звонок', { duration: 6000 });
      // Pre-warm the individual session query
      if (data?.sessionId) {
        void queryClient.invalidateQueries({ queryKey: callSessionKey(data.sessionId) });
      }
    });

    socket.on('call.updated', (data: { sessionId: string }) => {
      void queryClient.invalidateQueries({ queryKey: ACTIVE_CALLS_QUERY_KEY });
      if (data?.sessionId) {
        void queryClient.invalidateQueries({ queryKey: callSessionKey(data.sessionId) });
      }
    });

    socket.on(
      'call.transcript.segment',
      (data: { sessionId: string; segment: TranscriptSegment }) => {
        if (data?.segment && onSegment) {
          onSegment({ ...data.segment, live: true });
        }
        // Invalidate persisted transcript cache after short debounce
        if (data?.sessionId) {
          void queryClient.invalidateQueries({ queryKey: callSessionKey(data.sessionId) });
        }
      },
    );

    socket.on(
      'call.intent.detected',
      (data: { sessionId: string; intent: string; confidence: number }) => {
        if (data?.sessionId) {
          void queryClient.invalidateQueries({ queryKey: callSessionKey(data.sessionId) });
        }
      },
    );

    socket.on(
      'call.escalation.requested',
      (data: { sessionId: string; reason: string; recommendedAction: string }) => {
        onEscalation?.(data);
        void queryClient.invalidateQueries({ queryKey: ACTIVE_CALLS_QUERY_KEY });
        toast.warning(`Эскалация: ${data?.reason ?? '—'}`, {
          duration: 10_000,
          description:
            data?.recommendedAction === 'transfer_now'
              ? 'Перевод на оператора'
              : 'Оператор уведомлён',
        });
      },
    );

    socket.on('call.handoff.started', (data: { sessionId: string }) => {
      void queryClient.invalidateQueries({ queryKey: ACTIVE_CALLS_QUERY_KEY });
      if (data?.sessionId) {
        void queryClient.invalidateQueries({ queryKey: callSessionKey(data.sessionId) });
      }
    });

    socket.on('call.handoff.completed', (data: { sessionId: string }) => {
      void queryClient.invalidateQueries({ queryKey: ACTIVE_CALLS_QUERY_KEY });
      if (data?.sessionId) {
        void queryClient.invalidateQueries({ queryKey: callSessionKey(data.sessionId) });
      }
    });

    socket.on('call.ended', (data: { sessionId: string }) => {
      void queryClient.invalidateQueries({ queryKey: ACTIVE_CALLS_QUERY_KEY });
      if (data?.sessionId) {
        void queryClient.invalidateQueries({ queryKey: callSessionKey(data.sessionId) });
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);

  // Join/leave per-call room when active session changes
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket?.connected || !activeSessionId) return;
    joinSession(activeSessionId);
    return () => leaveSession(activeSessionId);
  }, [activeSessionId, joinSession, leaveSession]);

  return { takeover, joinSession, leaveSession };
}
