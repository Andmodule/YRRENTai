'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export interface Task {
  uuid: string;
  type: string;
  status: 'pending' | 'in_progress' | 'done' | 'issue';
  priority: 'urgent' | 'normal' | 'low';
  propertyId: string;
  propertyTitle: string;
  propertyAddress: string;
  /** Property.address only; fallback to propertyAddress if absent (older API). */
  streetAddress?: string;
  reservationId: string | null;
  contextLabel: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string;
  dueTime: string | null;
  notes: string;
  issueDescription: string | null;
  photoUrls: string[];
  hasVerificationPhoto: boolean;
  inProgressStartedAt: string | null;
  lastManagerSeenAt: string | null;
  unseenNotesCount: number;
  createdAt: string;
  completedAt: string | null;
  checklistSummary?: {
    total: number;
    checked: number;
    requiredUnchecked: number;
  } | null;
}

export interface TaskChecklistItem {
  uuid: string;
  text: string;
  required: boolean;
  sortOrder: number;
  checked: boolean;
  checkedAt: string | null;
}

export interface TaskNote {
  uuid: string;
  taskId: string;
  authorId: string;
  authorName: string;
  text: string;
  photoUrl: string | null;
  createdAt: string;
}

/** Same wide window as frontend-user TMA (`DEFAULT_TASK_FILTERS`), so STAFF sees all assigned tasks, not only due today. */
const STAFF_TASKS_FROM = '2000-01-01';
const STAFF_TASKS_TO = '2100-12-31';

export function useTodayTasks() {
  return useQuery<{ tasks: Task[] }>({
    queryKey: ['tasks', 'staff'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { tasks: Task[] } }>(
        `/tasks?from=${STAFF_TASKS_FROM}&to=${STAFF_TASKS_TO}`,
      );
      return { tasks: res.data.data.tasks };
    },
    staleTime: 15_000,
    /** Подстраховка, если сокет недоступен (фон Telegram, сеть). */
    refetchInterval: 45_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
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

export function useUploadIncidentPhotos() {
  return useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      const res = await apiClient.post<{ data: { photoUrls: string[] } }>(
        '/tasks/incidents/upload-photos',
        form,
      );
      return res.data.data.photoUrls;
    },
  });
}

export function useCreateIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      type: 'lost_item' | 'damage' | 'task_report';
      propertyId: string;
      taskId: string | null;
      description: string;
      photoUrls: string[];
      guestName?: string | null;
      itemDescription?: string | null;
      damageLocation?: string | null;
    }) => {
      const res = await apiClient.post<{ data: { incident: unknown } }>('/tasks/incidents', body);
      return res.data.data.incident;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useTaskNotes(taskUuid: string | null, enabled: boolean) {
  return useQuery<{ notes: TaskNote[] }>({
    queryKey: ['task-notes', taskUuid],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { notes: TaskNote[] } }>(
        `/tasks/${taskUuid}/notes`,
      );
      return { notes: res.data.data.notes };
    },
    enabled: !!taskUuid && enabled,
    staleTime: 15_000,
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
      status: Task['status'];
      issueDescription?: string;
    }) => {
      const res = await apiClient.patch<{ data: Task }>(`/tasks/${uuid}`, {
        status,
        issueDescription,
      });
      return res.data.data;
    },
    onMutate: async ({ uuid, status }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const prev = queryClient.getQueriesData<{ tasks: Task[] }>({ queryKey: ['tasks'] });
      queryClient.setQueriesData<{ tasks: Task[] }>({ queryKey: ['tasks'] }, (old) => {
        if (!old) return old;
        return {
          tasks: old.tasks.map((t) => (t.uuid === uuid ? { ...t, status } : t)),
        };
      });
      return { prev };
    },
    onError: (_, __, ctx) => {
      ctx?.prev?.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useUploadTaskPhotos() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ uuid, files }: { uuid: string; files: File[] }) => {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      const res = await apiClient.post<{ data: { photoUrls: string[] } }>(
        `/tasks/${uuid}/photos`,
        form,
      );
      return res.data.data.photoUrls;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useAddTaskNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ uuid, text, file }: { uuid: string; text: string; file?: File | null }) => {
      const form = new FormData();
      form.append('text', text);
      if (file) form.append('photo', file);
      const res = await apiClient.post<{ data: { note: TaskNote } }>(`/tasks/${uuid}/notes`, form);
      return res.data.data.note;
    },
    onSuccess: (_, v) => {
      queryClient.invalidateQueries({ queryKey: ['task-notes', v.uuid] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useCompleteShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ data: Record<string, unknown> }>('/users/me/shift-complete');
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-auth/me'] });
    },
  });
}
