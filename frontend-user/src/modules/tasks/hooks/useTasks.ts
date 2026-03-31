'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { apiClient } from '@/lib/api/client';
import type { Task, TaskFilters, TaskNote, TaskStatus, TasksApiResponse } from '../types';

export function useTasks(filters: TaskFilters, options?: { enabled?: boolean }) {
  const from = format(filters.dateRange.start, 'yyyy-MM-dd');
  const to = format(filters.dateRange.end, 'yyyy-MM-dd');

  const enabled = (options?.enabled ?? true) && filters.assigneeId !== 'none';

  return useQuery<TasksApiResponse>({
    queryKey: ['tasks', from, to, filters.assigneeId],
    enabled,
    queryFn: async () => {
      const params = new URLSearchParams({ from, to });
      if (filters.assigneeId !== 'all') {
        params.set('assigneeId', filters.assigneeId);
      }
      const res = await apiClient.get<{ data: { tasks: Task[] } }>(`/tasks?${params.toString()}`);
      return { tasks: res.data.data.tasks };
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useUpdateTaskStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      uuid,
      status,
      issueDescription,
    }: {
      uuid: string;
      status: TaskStatus;
      issueDescription?: string | null;
    }) => {
      const res = await apiClient.patch<{ data: Task }>(`/tasks/${uuid}`, {
        status,
        ...(issueDescription !== undefined ? { issueDescription } : {}),
      });
      return res.data.data;
    },
    onMutate: async ({ uuid, status }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const prev = queryClient.getQueriesData<TasksApiResponse>({ queryKey: ['tasks'] });
      queryClient.setQueriesData<TasksApiResponse>({ queryKey: ['tasks'] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          tasks: old.tasks.map((t) => (t.uuid === uuid ? { ...t, status } : t)),
        };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        ctx.prev.forEach(([key, data]) => {
          queryClient.setQueryData(key, data);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useUpdateTaskNotes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ uuid, notes }: { uuid: string; notes: string }) => {
      const res = await apiClient.patch<{ data: Task }>(`/tasks/${uuid}`, { notes });
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useTaskNotes(taskUuid: string | null, enabled: boolean) {
  return useQuery<TaskNote[]>({
    queryKey: ['task-notes', taskUuid],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { notes: TaskNote[] } }>(`/tasks/${taskUuid}/notes`);
      return res.data.data.notes;
    },
    enabled: !!taskUuid && enabled,
    staleTime: 15_000,
  });
}

export function useMarkTaskSeen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (uuid: string) => {
      await apiClient.patch(`/tasks/${uuid}/seen`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useUploadTaskPhotos() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ uuid, files }: { uuid: string; files: File[] }) => {
      const form = new FormData();
      for (const f of files) {
        form.append('files', f);
      }
      const res = await apiClient.post<{ data: { photoUrls: string[] } }>(`/tasks/${uuid}/photos`, form);
      return res.data.data.photoUrls;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
