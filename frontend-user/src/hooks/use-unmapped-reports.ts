'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export interface UnmappedReport {
  id: string;
  userId: string;
  staffName: string;
  photoUrl: string | null;
  transcript: string | null;
  createdAt: string;
}

export function useUnmappedReportsCount() {
  return useQuery({
    queryKey: ['unmapped-reports-count'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { count: number } }>('/telegram/unmapped-reports/count');
      return res.data.data.count;
    },
    staleTime: 30_000,
  });
}

export function useUnmappedReports() {
  return useQuery({
    queryKey: ['unmapped-reports'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { reports: UnmappedReport[] } }>(
        '/telegram/unmapped-reports',
      );
      return res.data.data.reports;
    },
    staleTime: 15_000,
  });
}

export function useAttachUnmappedReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, taskId }: { id: string; taskId: string }) => {
      await apiClient.post(`/telegram/unmapped-reports/${id}/attach`, { taskId });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['unmapped-reports'] });
      void queryClient.invalidateQueries({ queryKey: ['unmapped-reports-count'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useDismissUnmappedReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/telegram/unmapped-reports/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['unmapped-reports'] });
      void queryClient.invalidateQueries({ queryKey: ['unmapped-reports-count'] });
    },
  });
}
