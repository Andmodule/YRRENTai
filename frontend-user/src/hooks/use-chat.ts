'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessageMetadata } from '@rentai/shared';
import { connectChatSocket, getChatSocket } from '@/lib/socket/client';
import { apiClient } from '@/lib/api/client';

/** Mirrors backend `chat_messages.source` — staff = human reply from inbox. */
export type ChatMessageSource = 'ai' | 'staff';

/** Mirrors backend `MessageChannel` / `MessageDeliveryStatus`. */
export type MessageChannelCode =
  | 'BOOKING_API'
  | 'AIRBNB_API'
  | 'EMAIL'
  | 'TELEGRAM'
  | 'WHATSAPP';

export type MessageDeliveryStatusCode = 'DRAFT' | 'PENDING' | 'SENT' | 'ERROR';

export interface ChatMessage {
  id: string;
  propertyId: string;
  conversationId?: string;
  userId?: string | null;
  content: string;
  role: 'user' | 'assistant' | 'system';
  /** Present for messages loaded from API / socket; staff = manual manager reply. */
  source?: ChatMessageSource;
  /** OTA parse (Booking.com) or inbound email + R2 attachments. */
  metadata?: ChatMessageMetadata | null;
  /** Outbound routing channel (guest + assistant rows). */
  channel?: MessageChannelCode;
  /** Staff outbound delivery to guest (Booking/email/Telegram/…); AI/user rows are usually SENT. */
  deliveryStatus?: MessageDeliveryStatusCode;
  createdAt: string;
}

export interface UseChatOpts {
  /** When set, history and events are scoped to this conversation (inbox detail). */
  conversationId?: string | null;
}

interface UseChatReturn {
  messages: ChatMessage[];
  /** Inbox: true until the first REST load finishes (or fails and falls back to socket). Hides socket chat:history races. */
  isHistoryLoading: boolean;
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

function mapApiRowsToMessages(
  rows: Array<{
    id: string;
    propertyId: string;
    conversationId?: string;
    userId?: string | null;
    content: string;
    role: string;
    source?: string;
    channel?: string;
    deliveryStatus?: string;
    metadata?: ChatMessageMetadata | null;
    createdAt: string;
  }>,
): ChatMessage[] {
  return rows.map((m) => ({
    id: m.id,
    propertyId: m.propertyId,
    conversationId: m.conversationId,
    userId: m.userId,
    content: m.content,
    role: m.role as 'user' | 'assistant' | 'system',
    source: m.source === 'staff' ? 'staff' : m.source === 'ai' ? 'ai' : undefined,
    channel: (m.channel as MessageChannelCode | undefined) ?? undefined,
    deliveryStatus: (m.deliveryStatus as MessageDeliveryStatusCode | undefined) ?? undefined,
    metadata: m.metadata ?? undefined,
    createdAt:
      typeof m.createdAt === 'string'
        ? m.createdAt
        : new Date(m.createdAt as unknown as string).toISOString(),
  }));
}

export function useChat(propertyId: string | null, opts?: UseChatOpts | null): UseChatReturn {
  const conversationId = opts?.conversationId ?? undefined;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Inbox: block chat:history until REST settles (socket join fires first and can carry a stale thread). */
  const [isHistoryLoading, setIsHistoryLoading] = useState(() => !!opts?.conversationId);
  const inboxRestInitialDoneRef = useRef(!opts?.conversationId);
  /** Bumps on each effect run so a stale in-flight REST response cannot apply after switching conversations. */
  const loadGenerationRef = useRef(0);
  const currentPropertyId = useRef<string | null>(null);
  const conversationIdRef = useRef<string | undefined>(conversationId);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const matchesConversation = useCallback((payload: { conversationId?: string }) => {
    const cur = conversationIdRef.current;
    if (!cur) return true;
    if (!payload.conversationId) return false;
    return payload.conversationId.toLowerCase() === cur.toLowerCase();
  }, []);

  useEffect(() => {
    if (!propertyId) return;

    setMessages([]);
    setStreamingText('');
    setIsStreaming(false);

    if (conversationId) {
      inboxRestInitialDoneRef.current = false;
      setIsHistoryLoading(true);
    } else {
      inboxRestInitialDoneRef.current = true;
      setIsHistoryLoading(false);
    }

    let cancelled = false;
    let detachListeners: (() => void) | undefined;
    const loadGeneration = ++loadGenerationRef.current;
    /** Serial for REST tail fetches — ignore stale responses when initial load and `conversation:updated` overlap. */
    let messagesFetchSeq = 0;

    function markInboxHistoryReady() {
      inboxRestInitialDoneRef.current = true;
      setIsHistoryLoading(false);
    }

    function isStaleLoad(): boolean {
      return cancelled || loadGeneration !== loadGenerationRef.current;
    }

    async function refetchMessagesForOpenConversation(targetConversationId: string) {
      if (cancelled || !propertyId) return;
      const seq = ++messagesFetchSeq;
      try {
        const res = await apiClient.get<{
          data: Array<{
            id: string;
            propertyId: string;
            conversationId?: string;
            userId?: string | null;
            content: string;
            role: string;
            source?: string;
            channel?: string;
            deliveryStatus?: string;
            metadata?: ChatMessageMetadata | null;
            createdAt: string;
          }>;
        }>(`/chats/conversations/${encodeURIComponent(targetConversationId)}/messages`, {
          params: { page: 1, limit: 100, _t: Date.now() },
          headers: {
            'Cache-Control': 'no-cache, no-store',
            Pragma: 'no-cache',
          },
        });
        if (isStaleLoad()) return;
        if (seq !== messagesFetchSeq) return;
        if (conversationIdRef.current?.toLowerCase() !== targetConversationId.toLowerCase()) {
          return;
        }
        const rows = res.data.data;
        if (!Array.isArray(rows)) {
          markInboxHistoryReady();
          return;
        }
        markInboxHistoryReady();
        /** Full replace — merge with `prev` caused wrong-thread bubbles when switching chats before React flushed `setMessages([])`. */
        setMessages(mapApiRowsToMessages(rows));
      } catch {
        if (isStaleLoad()) return;
        if (seq !== messagesFetchSeq) return;
        if (conversationIdRef.current?.toLowerCase() !== targetConversationId.toLowerCase()) {
          return;
        }
        markInboxHistoryReady();
        const s = getChatSocket();
        if (s?.connected) {
          s.emit('chat:join', {
            propertyId,
            conversationId: targetConversationId,
          });
        }
      }
    }

    /** Inbox: load from API as soon as the dialog opens — do not wait for the socket (fixes stale chat:history races). */
    if (conversationId) {
      void refetchMessagesForOpenConversation(conversationId);
    }

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
          conversationId?: string;
          messages: ChatMessage[];
        }) {
          if (data.propertyId !== currentPropertyId.current) return;
          const cur = conversationIdRef.current;
          if (cur) {
            if (!inboxRestInitialDoneRef.current) {
              return;
            }
            if (!data.conversationId || data.conversationId.toLowerCase() !== cur.toLowerCase()) {
              return;
            }
            /**
             * Inbox: REST is the source of truth after first load. `chat:history` uses the same tail query
             * now, but must never replace a non-empty list with a shorter snapshot (reconnect / race).
             */
            setMessages((prev) => {
              if (prev.length > 0) {
                return prev;
              }
              return Array.isArray(data.messages) ? data.messages : [];
            });
            return;
          }
          setMessages(Array.isArray(data.messages) ? data.messages : []);
        }

        function handleMessageSaved(msg: ChatMessage) {
          if (msg.propertyId !== currentPropertyId.current) return;
          if (!matchesConversation(msg)) return;
          setMessages((prev) => {
            const i = prev.findIndex((m) => m.id === msg.id);
            if (i === -1) return [...prev, msg];
            return prev.map((m, idx) => (idx === i ? { ...m, ...msg } : m));
          });
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
          setMessages((prev) => {
            const i = prev.findIndex((m) => m.id === msg.id);
            if (i === -1) return [...prev, msg];
            return prev.map((m, idx) => (idx === i ? { ...m, ...msg } : m));
          });
        }

        function handleDraftRemoved(data: {
          propertyId: string;
          conversationId?: string;
          messageId: string;
        }) {
          if (data.propertyId !== currentPropertyId.current) return;
          if (!matchesConversation(data)) return;
          setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
        }

        function handleMessageStatusUpdated(data: {
          propertyId: string;
          messageId: string;
          status: string;
          channel?: string;
          conversationId?: string;
        }) {
          if (data.propertyId !== currentPropertyId.current) return;
          if (!matchesConversation(data)) return;
          const ds = data.status as MessageDeliveryStatusCode;
          const ch = data.channel as MessageChannelCode | undefined;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === data.messageId
                ? {
                    ...m,
                    deliveryStatus: ds,
                    ...(ch ? { channel: ch } : {}),
                  }
                : m,
            ),
          );
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

        /** Левая колонка уже обновилась по этому событию; правая подтягивает те же сообщения с API (надёжнее, чем только сокет). */
        async function handleConversationUpdated(payload: { conversationId?: string }) {
          if (isStaleLoad()) return;
          if (!payload?.conversationId) return;
          const cur = conversationIdRef.current;
          if (!cur) return;
          if (payload.conversationId.toLowerCase() !== cur.toLowerCase()) return;
          await refetchMessagesForOpenConversation(payload.conversationId);
        }

        function onWindowFocus() {
          const cur = conversationIdRef.current;
          if (!cur || isStaleLoad() || !propertyId) return;
          void refetchMessagesForOpenConversation(cur);
        }

        /** Edge / bfcache: focus alone may not run after back-forward restore. */
        function onPageShow(e: PageTransitionEvent) {
          if (e.persisted) onWindowFocus();
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
        s.on('conversation:updated', handleConversationUpdated);
        s.on('message_status_updated', handleMessageStatusUpdated);
        s.on('message:draft_removed', handleDraftRemoved);

        if (typeof window !== 'undefined') {
          window.addEventListener('focus', onWindowFocus);
          window.addEventListener('pageshow', onPageShow as (ev: Event) => void);
        }

        detachListeners = () => {
          if (typeof window !== 'undefined') {
            window.removeEventListener('focus', onWindowFocus);
            window.removeEventListener('pageshow', onPageShow as (ev: Event) => void);
          }
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
          s.off('conversation:updated', handleConversationUpdated);
          s.off('message_status_updated', handleMessageStatusUpdated);
          s.off('message:draft_removed', handleDraftRemoved);
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

  return {
    messages,
    isHistoryLoading,
    streamingText,
    isStreaming,
    isConnected,
    error,
    sendMessage,
  };
}
