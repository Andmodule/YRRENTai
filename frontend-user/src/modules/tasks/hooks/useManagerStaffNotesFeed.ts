'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import type { TaskNoteFeedItem } from '../types';

export function useManagerStaffNotesFeed(enabled: boolean) {
  return useQuery({
    queryKey: ['tasks', 'manager-staff-notes-feed'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { items: TaskNoteFeedItem[] } }>(
        '/tasks/manager/staff-notes-feed?limit=200',
      );
      return res.data.data.items;
    },
    enabled,
    staleTime: 15_000,
  });
}

export function useManagerUnseenStaffNotesCount(enabled = true) {
  return useQuery({
    queryKey: ['tasks', 'manager-unseen-staff-notes-count'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { count: number } }>(
        '/tasks/manager/unseen-staff-notes-count',
      );
      return res.data.data.count;
    },
    enabled,
    staleTime: 10_000,
  });
}
