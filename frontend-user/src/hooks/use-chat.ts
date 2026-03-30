'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { connectChatSocket, disconnectChatSocket, getChatSocket } from '@/lib/socket/client';

export interface ChatMessage {
  id: string;
  propertyId: string;
  userId?: string | null;
  content: string;
  role: 'user' | 'assistant' | 'system';
  createdAt: string;
}

interface UseChatReturn {
  messages: ChatMessage[];
  streamingText: string;
  isStreaming: boolean;
  isConnected: boolean;
  error: string | null;
  sendMessage: (content: string) => void;
}

export function useChat(propertyId: string | null): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentPropertyId = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      disconnectChatSocket();
    };
  }, []);

  useEffect(() => {
    if (!propertyId) return;

    let cancelled = false;
    let socket: Socket | null = null;
    let detachListeners: (() => void) | undefined;

    connectChatSocket()
      .then((s) => {
        if (cancelled) {
          s.disconnect();
          disconnectChatSocket();
          return;
        }
        socket = s;
        currentPropertyId.current = propertyId;

        function handleConnect() {
          if (cancelled) return;
          setIsConnected(true);
          setError(null);
          s.emit('chat:join', { propertyId });
        }

        function handleDisconnect() {
          setIsConnected(false);
        }

        function handleHistory(data: { propertyId: string; messages: ChatMessage[] }) {
          if (data.propertyId === currentPropertyId.current) {
            setMessages(data.messages);
          }
        }

        function handleMessageSaved(msg: ChatMessage) {
          if (msg.propertyId === currentPropertyId.current) {
            setMessages((prev) => [...prev, msg]);
          }
        }

        function handleStreamStart(data: { propertyId: string }) {
          if (data.propertyId === currentPropertyId.current) {
            setIsStreaming(true);
            setStreamingText('');
          }
        }

        function handleStreamChunk(data: { propertyId: string; text: string }) {
          if (data.propertyId === currentPropertyId.current) {
            setStreamingText((prev) => prev + data.text);
          }
        }

        function handleStreamEnd(msg: ChatMessage) {
          if (msg.propertyId === currentPropertyId.current) {
            setIsStreaming(false);
            setStreamingText('');
            setMessages((prev) => [...prev, msg]);
          }
        }

        function handleAgentError(data: { propertyId: string; message: string }) {
          if (data.propertyId === currentPropertyId.current) {
            setIsStreaming(false);
            setStreamingText('');
            setError(data.message);
          }
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
  }, [propertyId]);

  const sendMessage = useCallback(
    (content: string) => {
      if (!propertyId || !content.trim()) return;
      setError(null);
      const s = getChatSocket();
      if (!s?.connected) return;
      s.emit('message:send', { propertyId, content: content.trim() });
    },
    [propertyId],
  );

  return { messages, streamingText, isStreaming, isConnected, error, sendMessage };
}
