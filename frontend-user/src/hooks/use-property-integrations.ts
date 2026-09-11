'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export interface IcalSyncPropertyResponse {
  results: Array<{
    url: string;
    imported: number;
    updated: number;
    cancelled: number;
    failed: number;
    error?: string;
  }>;
}

export interface ZodomusImportSummaryResponse {
  imported: number;
  failed: number;
}

export interface ZodomusQueueSyncResponse {
  processed: number;
  skipped: number;
  failed: number;
}

/** POST /ical/sync-property — pull all saved iCal URLs for one property. */
export function useIcalSyncProperty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (propertyId: string) => {
      const res = await apiClient.post<{ data: IcalSyncPropertyResponse }>('/ical/sync-property', {
        propertyId,
      });
      return res.data?.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
  });
}

/** POST /integrations/zodomus/import-summary — future reservations from Zodomus (onboarding). */
export function useZodomusImportSummary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { propertyId: string; channelId: number }) => {
      const res = await apiClient.post<{ data: ZodomusImportSummaryResponse }>(
        '/integrations/zodomus/import-summary',
        { propertyId: vars.propertyId, channelId: vars.channelId },
      );
      const d = res.data?.data;
      if (!d || typeof d.imported !== 'number') throw new Error('Invalid import-summary response');
      return d;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
    },
  });
}

/** POST /integrations/zodomus/sync — process Zodomus reservations-queue for this property (GET /reservations per item). */
export function useZodomusQueueSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { propertyId: string; channelId: number; force?: boolean }) => {
      const res = await apiClient.post<{ data: ZodomusQueueSyncResponse }>('/integrations/zodomus/sync', {
        propertyId: vars.propertyId,
        channelId: vars.channelId,
        force: Boolean(vars.force),
      });
      const d = res.data?.data;
      if (!d || typeof d.processed !== 'number' || typeof d.skipped !== 'number') {
        throw new Error('Invalid zodomus sync response');
      }
      return {
        ...d,
        failed: typeof d.failed === 'number' ? d.failed : 0,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
    },
  });
}

export interface ZodomusRefreshStatusResponse {
  checked: number;
  results: Array<{ propertyId: string; status: string | null; detail: string | null }>;
  status?: 'disabled';
}

/** POST /integrations/zodomus/refresh-status — probe listing status without importing bookings. */
export function useZodomusRefreshStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars?: { propertyId?: string; channelId?: number }) => {
      const res = await apiClient.post<{ data: ZodomusRefreshStatusResponse }>(
        '/integrations/zodomus/refresh-status',
        {
          propertyId: vars?.propertyId,
          channelId: vars?.channelId ?? 1,
        },
      );
      return res.data?.data ?? { checked: 0, results: [] };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['properties'] });
    },
  });
}
