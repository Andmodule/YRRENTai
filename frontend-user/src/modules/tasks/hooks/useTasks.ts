'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { apiClient } from '@/lib/api/client';
import type {
  Task,
  TaskChecklistItem,
  TaskFilters,
  TaskNote,
  TaskPriority,
  TaskStatus,
  TasksApiResponse,
} from '../types';

const API_WIDE_FROM = '2000-01-01';
const API_WIDE_TO = '2100-12-31';

export function useTasks(filters: TaskFilters, options?: { enabled?: boolean }) {
  const from = filters.dateRangeEnabled
    ? format(filters.dateRange.start, 'yyyy-MM-dd')
    : API_WIDE_FROM;
  const to = filters.dateRangeEnabled
    ? format(filters.dateRange.end, 'yyyy-MM-dd')
    : API_WIDE_TO;

  const enabled = (options?.enabled ?? true) && filters.assigneeId !== 'none';

  return useQuery<TasksApiResponse>({
    queryKey: ['tasks', from, to, filters.assigneeId, filters.dateRangeEnabled],
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
          tasks: old.tasks.map((t) =>
            t.uuid === uuid
              ? {
                  ...t,
                  status,
                  completedAt: status === 'done' ? new Date().toISOString() : null,
                }
              : t,
          ),
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
      /** Linked incident may change (e.g. task → done → incident in_review); socket may be offline in dev. */
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['incidents-open-count'] });
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

export type PatchTaskBody = Partial<{
  title: string;
  priority: TaskPriority;
  propertyId: string;
  assigneeId: string | null;
}>;

export function usePatchTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ uuid, ...body }: { uuid: string } & PatchTaskBody) => {
      const res = await apiClient.patch<{ data: Task }>(`/tasks/${uuid}`, body);
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useTaskChecklist(taskUuid: string | null, enabled: boolean) {
  return useQuery<{ items: TaskChecklistItem[] }>({
    queryKey: ['task-checklist', taskUuid],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { items: TaskChecklistItem[] } }>(
        `/tasks/${taskUuid}/checklist`,
      );
      return { items: res.data.data.items };
    },
    enabled: !!taskUuid && enabled,
    staleTime: 15_000,
  });
}

export function usePatchTaskChecklistItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      taskUuid,
      itemId,
      checked,
    }: {
      taskUuid: string;
      itemId: string;
      checked: boolean;
    }) => {
      const res = await apiClient.patch<{ data: { item: TaskChecklistItem } }>(
        `/tasks/${taskUuid}/checklist/${itemId}`,
        { checked },
      );
      return res.data.data.item;
    },
    onSuccess: (_, v) => {
      queryClient.invalidateQueries({ queryKey: ['task-checklist', v.taskUuid] });
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
