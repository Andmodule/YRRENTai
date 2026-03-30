'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { connectChatSocket, getChatSocket } from '@/lib/socket/client';

export interface ChatMessage {
  id: string;
  propertyId: string;
  conversationId?: string;
  userId?: string | null;
  content: string;
  role: 'user' | 'assistant' | 'system';
  createdAt: string;
}

export interface UseChatOpts {
  /** When set, history and events are scoped to this conversation (inbox detail). */
  conversationId?: string | null;
}

interface UseChatReturn {
  messages: ChatMessage[];
  streamingText: string;
  isStreaming: boolean;
  isConnected: boolean;
  error: string | null;
  /** Guest-style test message. Use `guestSessionKey` (dev) to open a new thread without conversationId. */
  sendMessage: (content: string, sendOpts?: { guestSessionKey?: string }) => void;
}

interface StreamPayload {
  propertyId: string;
  conversationId?: string;
  text?: string;
  message?: string;
}

export function useChat(propertyId: string | null, opts?: UseChatOpts | null): UseChatReturn {
  const conversationId = opts?.conversationId ?? undefined;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentPropertyId = useRef<string | null>(null);
  const conversationIdRef = useRef<string | undefined>(conversationId);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const matchesConversation = useCallback((payload: { conversationId?: string }) => {
    const cur = conversationIdRef.current;
    if (!cur) return true;
    if (!payload.conversationId) return false;
    return payload.conversationId === cur;
  }, []);

  useEffect(() => {
    if (!propertyId) return;

    let cancelled = false;
    let detachListeners: (() => void) | undefined;

    connectChatSocket()
      .then((s) => {
        /** Do not call disconnectChatSocket() here — React Strict Mode remounts; killing the singleton breaks the second mount. */
        if (cancelled) {
          return;
        }
        currentPropertyId.current = propertyId;

        function handleConnect() {
          if (cancelled) return;
          setIsConnected(true);
          setError(null);
          s.emit('chat:join', {
            propertyId,
            ...(conversationId ? { conversationId } : {}),
          });
        }

        function handleDisconnect() {
          setIsConnected(false);
        }

        function handleHistory(data: {
          propertyId: string;
          messages: ChatMessage[];
        }) {
          if (data.propertyId !== currentPropertyId.current) return;
          setMessages(data.messages);
        }

        function handleMessageSaved(msg: ChatMessage) {
          if (msg.propertyId !== currentPropertyId.current) return;
          if (!matchesConversation(msg)) return;
          setMessages((prev) => [...prev, msg]);
        }

        function handleStreamStart(data: StreamPayload) {
          if (data.propertyId !== currentPropertyId.current) return;
          if (!matchesConversation(data)) return;
          setIsStreaming(true);
          setStreamingText('');
        }

        function handleStreamChunk(data: StreamPayload) {
          if (data.propertyId !== currentPropertyId.current) return;
          if (!matchesConversation(data)) return;
          setStreamingText((prev) => prev + (data.text ?? ''));
        }

        function handleStreamEnd(msg: ChatMessage & { conversationId?: string }) {
          if (msg.propertyId !== currentPropertyId.current) return;
          if (!matchesConversation(msg)) return;
          setIsStreaming(false);
          setStreamingText('');
          setMessages((prev) => [...prev, msg]);
        }

        function handleAgentError(data: StreamPayload) {
          if (data.propertyId !== currentPropertyId.current) return;
          if (!matchesConversation(data)) return;
          setIsStreaming(false);
          setStreamingText('');
          setError(data.message ?? 'Agent error');
        }

        function handleError(data: { message: string }) {
          setError(data.message);
        }

        s.on('connect', handleConnect);
        s.on('disconnect', handleDisconnect);
        s.on('chat:history', handleHistory);
        s.on('message:saved', handleMessageSaved);
        s.on('agent:streamStart', handleStreamStart);
        s.on('agent:streamChunk', handleStreamChunk);
        s.on('agent:streamEnd', handleStreamEnd);
        s.on('agent:error', handleAgentError);
        s.on('error', handleError);

        detachListeners = () => {
          s.emit('chat:leave', { propertyId });
          s.off('connect', handleConnect);
          s.off('disconnect', handleDisconnect);
          s.off('chat:history', handleHistory);
          s.off('message:saved', handleMessageSaved);
          s.off('agent:streamStart', handleStreamStart);
          s.off('agent:streamChunk', handleStreamChunk);
          s.off('agent:streamEnd', handleStreamEnd);
          s.off('agent:error', handleAgentError);
          s.off('error', handleError);
        };

        if (s.connected) {
          handleConnect();
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Connection failed';
          setError(msg);
        }
      });

    return () => {
      cancelled = true;
      detachListeners?.();
      currentPropertyId.current = null;
    };
  }, [propertyId, conversationId, matchesConversation]);

  const sendMessage = useCallback(
    (content: string, sendOpts?: { guestSessionKey?: string }) => {
      if (!propertyId || !content.trim()) return;
      setError(null);
      const s = getChatSocket();
      if (!s?.connected) return;
      const trimmed = content.trim();
      if (sendOpts?.guestSessionKey) {
        s.emit('message:send', {
          propertyId,
          content: trimmed,
          guestSessionKey: sendOpts.guestSessionKey,
        });
        return;
      }
      if (conversationId) {
        s.emit('message:send', { propertyId, content: trimmed, conversationId });
        return;
      }
      s.emit('message:send', { propertyId, content: trimmed });
    },
    [propertyId, conversationId],
  );

  return { messages, streamingText, isStreaming, isConnected, error, sendMessage };
}
