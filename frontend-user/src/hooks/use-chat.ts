'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
    if (!propertyId) return;

    const socket = connectChatSocket();
    currentPropertyId.current = propertyId;

    function handleConnect() {
      setIsConnected(true);
      setError(null);
      socket.emit('chat:join', { propertyId });
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

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('chat:history', handleHistory);
    socket.on('message:saved', handleMessageSaved);
    socket.on('agent:streamStart', handleStreamStart);
    socket.on('agent:streamChunk', handleStreamChunk);
    socket.on('agent:streamEnd', handleStreamEnd);
    socket.on('agent:error', handleAgentError);
    socket.on('error', handleError);

    if (socket.connected) {
      handleConnect();
    }

    return () => {
      if (currentPropertyId.current) {
        socket.emit('chat:leave', { propertyId: currentPropertyId.current });
      }
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('chat:history', handleHistory);
      socket.off('message:saved', handleMessageSaved);
      socket.off('agent:streamStart', handleStreamStart);
      socket.off('agent:streamChunk', handleStreamChunk);
      socket.off('agent:streamEnd', handleStreamEnd);
      socket.off('agent:error', handleAgentError);
      socket.off('error', handleError);
      currentPropertyId.current = null;
    };
  }, [propertyId]);

  useEffect(() => {
    return () => {
      disconnectChatSocket();
    };
  }, []);

  const sendMessage = useCallback(
    (content: string) => {
      if (!propertyId || !content.trim()) return;
      setError(null);
      const socket = getChatSocket();
      socket.emit('message:send', { propertyId, content: content.trim() });
    },
    [propertyId],
  );

  return { messages, streamingText, isStreaming, isConnected, error, sendMessage };
}
