'use client';

import { useCallback, useEffect } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/api/fetcher';
import { apiClient } from '@/lib/api/client';
import { getChatSocket } from '@/lib/socket/client';
import type { ConversationStatus } from '@rentai/shared/constants';

export interface ConversationDto {
  id: string;
  propertyId: string;
  propertyName: string;
  channel: string;
  status: ConversationStatus;
  externalGuestKey: string | null;
  lastMessagePreview: string | null;
  lastActivityAt: string;
  createdAt: string;
}

interface ConversationsPage {
  data: ConversationDto[];
  meta: { page: number; limit: number; total: number; totalPages: number };
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

  const { data, error, isLoading, mutate } = useSWR<ConversationsPage>(key, fetcher);

  useEffect(() => {
    const socket = getChatSocket();
    if (!socket) return;

    function handleUpdate() {
      mutate();
    }

    socket.on('conversation:updated', handleUpdate);
    return () => {
      socket.off('conversation:updated', handleUpdate);
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
