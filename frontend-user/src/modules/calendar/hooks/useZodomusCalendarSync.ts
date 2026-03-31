'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

interface SyncAllResponse {
  processed: number;
  skipped: number;
  failed: number;
  propertiesTouched: number;
}

export function useZodomusCalendarSync(defaultChannelId = 1) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars?: { force?: boolean }) => {
      const res = await apiClient.post<{ data: SyncAllResponse }>('/integrations/zodomus/sync-all', {
        channelId: defaultChannelId,
        force: Boolean(vars?.force),
      });
      const r = res.data?.data;
      if (!r || typeof r.processed !== 'number' || typeof r.skipped !== 'number') {
        throw new Error('Invalid sync-all response');
      }
      return {
        ...r,
        failed: typeof r.failed === 'number' ? r.failed : 0,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
  });
}
