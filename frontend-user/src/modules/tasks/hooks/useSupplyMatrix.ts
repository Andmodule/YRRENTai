'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import type { SupplyMatrixRow } from '../types';

const matrixKey = ['tasks', 'manager-supply-matrix'] as const;

export function useSupplyMatrix(enabled = true) {
  return useQuery({
    queryKey: matrixKey,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<{ data: { rows: SupplyMatrixRow[] } }>('/tasks/manager/supply-matrix', {
        signal,
      });
      return res.data.data.rows;
    },
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useSupplyMatrixLineDetail(requestLineIds: string[] | null, enabled: boolean) {
  return useQuery({
    queryKey: [...matrixKey, 'detail', ...(requestLineIds ?? []).sort()],
    queryFn: async () => {
      const res = await apiClient.post<{
        data: {
          lines: Array<{
            requestLineId: string;
            propertyId: string;
            propertyTitle: string;
            eventId: string;
            textRaw: string;
            createdAt: string;
            authorName: string;
            quantity: string | null;
            unit: string | null;
            llmRawName: string | null;
          }>;
        };
      }>('/tasks/manager/supply-matrix/detail-lines', { requestLineIds: requestLineIds ?? [] });
      return res.data.data.lines;
    },
    enabled: enabled && !!requestLineIds?.length,
  });
}

export function useSupplyMatrixHandoff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { supplyItemIds?: string[]; requestLineIds?: string[] }) => {
      const body: { supplyItemIds?: string[]; requestLineIds?: string[] } = {};
      if (payload.supplyItemIds?.length) body.supplyItemIds = payload.supplyItemIds;
      if (payload.requestLineIds?.length) body.requestLineIds = payload.requestLineIds;
      const res = await apiClient.post<{ data: { updated: number } }>('/tasks/manager/supply-matrix/handoff', body);
      return res.data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: matrixKey });
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-interpretations'] });
    },
  });
}

export function useSupplyMatrixMarkDelivered() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestLineIds: string[]) => {
      const res = await apiClient.post<{ data: { updated: number } }>('/tasks/manager/supply-matrix/mark-delivered', {
        requestLineIds,
      });
      return res.data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: matrixKey });
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-interpretations'] });
    },
  });
}

export function useSupplyCatalogItems(enabled = true) {
  return useQuery({
    queryKey: ['tasks', 'manager-supply-catalog'],
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<{
        data: {
          items: Array<{ id: string; name: string; category: string; defaultUnit: string | null; aliases: string[] }>;
        };
      }>('/tasks/manager/supply-catalog/items', { signal });
      return res.data.data.items;
    },
    enabled,
  });
}

export function useCreateSupplyCatalogItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; synonyms: string; defaultUnit?: string | null; category?: string }) => {
      const res = await apiClient.post<{ data: { id: string; name: string } }>('/tasks/manager/supply-catalog/items', body);
      return res.data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-catalog'] });
      void queryClient.invalidateQueries({ queryKey: matrixKey });
    },
  });
}
