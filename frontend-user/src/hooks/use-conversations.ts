'use client';

import { useCallback, useEffect } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/api/fetcher';
import { apiClient } from '@/lib/api/client';
import { connectChatSocket } from '@/lib/socket/client';
import type { ConversationStatus } from '@rentai/shared/constants';

export interface ConversationDto {
  id: string;
  propertyId: string;
  propertyName: string;
  channel: string;
  status: ConversationStatus;
  externalGuestKey: string | null;
  /** Имя для заголовка (OTA); может отсутствовать в старых ответах API. */
  guestDisplayName?: string | null;
  lastMessagePreview: string | null;
  lastActivityAt: string;
  createdAt: string;
}

interface ConversationsPage {
  data: ConversationDto[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

/** Payload с бэкенда (`chat.gateway` → `conversation:updated`) */
export interface ConversationSocketPayload {
  conversationId: string;
  lastMessagePreview?: string;
  lastActivityAt?: string;
  status?: ConversationStatus;
}

export function sortConversationsByActivity(rows: ConversationDto[]): ConversationDto[] {
  return [...rows].sort(
    (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
  );
}

interface UseConversationsOpts {
  status?: ConversationStatus;
  propertyId?: string;
  page?: number;
  limit?: number;
}

export function useConversations(opts: UseConversationsOpts = {}) {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.propertyId) params.set('propertyId', opts.propertyId);
  params.set('page', String(opts.page ?? 1));
  params.set('limit', String(opts.limit ?? 30));

  const key = `/chats/conversations?${params.toString()}`;

  const { data, error, isLoading, mutate } = useSWR<ConversationsPage>(key, fetcher, {
    /** Иначе refetch после сокета может быть отложен до 2s — лаг точек и новых чатов */
    dedupingInterval: 0,
  });

  /**
   * Нельзя полагаться на getChatSocket() в первом рендере: эффекты дочерних компонентов
   * (InboxList) выполняются раньше родительского ChatPage, где вызывается connectChatSocket().
   * Без явного connect подписка на conversation:updated не ставилась — список не обновлялся.
   *
   * Payload сразу патчит кэш (точки/превью без ожидания GET); для нового чата в списке — revalidate.
   */
  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | undefined;

    connectChatSocket()
      .then((socket) => {
        if (cancelled) return;

        function handleConversationUpdated(payload: ConversationSocketPayload) {
          if (!payload?.conversationId) {
            void mutate(undefined, { revalidate: true });
            return;
          }

          void mutate(
            (current) => {
              if (!current?.data) {
                queueMicrotask(() => void mutate(undefined, { revalidate: true }));
                return current;
              }
              const idx = current.data.findIndex(
                (c) => c.id.toLowerCase() === payload.conversationId.toLowerCase(),
              );
              /**
               * Новый диалог (email и т.д.) ещё не в кэше: тот же `current` + revalidate:true
               * в SWR часто не триггерит refetch — форсируем отдельный GET.
               */
              if (idx < 0) {
                queueMicrotask(() => void mutate(undefined, { revalidate: true }));
                return current;
              }
              const row = current.data[idx];
              if (!row) return current;
              const nextRow: ConversationDto = {
                ...row,
                status: payload.status ?? row.status,
                lastMessagePreview:
                  payload.lastMessagePreview !== undefined
                    ? payload.lastMessagePreview
                    : row.lastMessagePreview,
                lastActivityAt: payload.lastActivityAt ?? row.lastActivityAt,
              };
              const nextData = [...current.data];
              nextData[idx] = nextRow;
              return { ...current, data: sortConversationsByActivity(nextData) };
            },
            { revalidate: true },
          );
        }

        /** После reconnect — подтянуть список, если события пропустили. */
        function handleReconnect() {
          void mutate(undefined, { revalidate: true });
        }

        socket.on('conversation:updated', handleConversationUpdated);
        socket.on('reconnect', handleReconnect);
        detach = () => {
          socket.off('conversation:updated', handleConversationUpdated);
          socket.off('reconnect', handleReconnect);
        };
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      detach?.();
    };
  }, [mutate]);

  const reply = useCallback(
    async (conversationId: string, content: string) => {
      const res = await apiClient.post('/chats/conversations/reply', {
        conversationId,
        content,
      });
      await mutate();
      return res.data;
    },
    [mutate],
  );

  return {
    conversations: data?.data ?? [],
    meta: data?.meta,
    isLoading,
    isError: !!error,
    mutate,
    reply,
  };
}
