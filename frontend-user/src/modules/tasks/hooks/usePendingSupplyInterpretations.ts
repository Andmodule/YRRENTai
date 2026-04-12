'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import type { PendingSupplyInterpretationEvent } from '../types';

/** Единый вид строки ленты (GET и setQueryData после POST). */
export function normalizePendingSupplyEvent(e: PendingSupplyInterpretationEvent): PendingSupplyInterpretationEvent {
  const propertyId =
    (e.propertyId && e.propertyId.trim()) ||
    (e.targetType === 'property' && e.targetId?.trim()) ||
    '';
  return {
    ...e,
    propertyId,
    managerBucket: e.managerBucket ?? 'supply',
    llmIntent: e.llmIntent ?? null,
  };
}

export function usePendingSupplyInterpretations(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['tasks', 'manager-supply-interpretations'],
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<{ data: { events: PendingSupplyInterpretationEvent[] } }>(
        '/tasks/manager/supply-interpretations',
        { signal },
      );
      return res.data.data.events.map(normalizePendingSupplyEvent);
    },
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
    /**
     * Пока есть записи в разборе ИИ — чаще опрос, чтобы карточка обновилась сразу после LLM.
     * Иначе реже, чтобы не долбить API.
     */
    refetchInterval: (query) => {
      const data = query.state.data;
      if (
        Array.isArray(data) &&
        data.some(
          (e) => e.workflowState === 'pending_llm' || e.llmStatus === 'processing',
        )
      ) {
        return 4000;
      }
      return 12_000;
    },
    refetchIntervalInBackground: false,
  });
}

export function useResolveSupplyInterpretation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { eventId: string; action: 'acknowledge' | 'dismiss' }) => {
      const res = await apiClient.patch<{ data: { id: string; workflowState: string } }>(
        `/tasks/manager/supply-interpretations/${input.eventId}`,
        { action: input.action },
      );
      return res.data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-interpretations'] });
    },
  });
}

export function useRetrySupplyInterpretationLlm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (eventId: string) => {
      const res = await apiClient.post<{ data: { id: string; llmStatus: string } }>(
        `/tasks/manager/supply-interpretations/${eventId}/retry-llm`,
      );
      return res.data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-interpretations'] });
    },
  });
}
