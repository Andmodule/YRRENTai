'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { format } from 'date-fns';
import { apiClient } from '@/lib/api/client';
import { idEquals } from '@/lib/utils';
import type {
  Task,
  TaskChecklistItem,
  TaskFilters,
  TaskNote,
  TaskPriority,
  TaskStatus,
  TasksApiResponse,
  TaskType,
} from '../types';

const API_WIDE_FROM = '2000-01-01';
const API_WIDE_TO = '2100-12-31';

/** Каноническое состояние задачи (GET). После PATCH список и дроер сверяем с этим — ответ PATCH иногда приходит в неожиданной форме или обгоняется сокетом. */
export async function fetchTaskByUuid(uuid: string, signal?: AbortSignal): Promise<Task> {
  const res = await apiClient.get<{ data: { task: Task } }>(`/tasks/${uuid}`, { signal });
  return res.data.data.task;
}

/** Ответ PATCH: `{ data: Task }` или редко вложенный `{ data: { task: Task } }`. */
function parseTaskFromPatchResponse(res: { data: { data?: unknown } }): Task | null {
  const raw = res.data?.data;
  if (raw && typeof raw === 'object' && 'uuid' in raw && typeof (raw as Task).uuid === 'string') {
    return raw as Task;
  }
  if (
    raw &&
    typeof raw === 'object' &&
    'task' in raw &&
    (raw as { task: Task }).task &&
    typeof (raw as { task: Task }).task.uuid === 'string'
  ) {
    return (raw as { task: Task }).task;
  }
  return null;
}

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
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ from, to });
      if (filters.assigneeId !== 'all') {
        params.set('assigneeId', filters.assigneeId);
      }
      const res = await apiClient.get<{ data: { tasks: Task[] } }>(`/tasks?${params.toString()}`, {
        signal,
      });
      return { tasks: res.data.data.tasks };
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    /** Список часто патчится; без этого RQ может считать merge «тем же» и не дернуть ререндер. */
    structuralSharing: false,
  });
}

/** Одна задача по UUID (не зависит от фильтра списка по исполнителю). Нужна, чтобы дроер не терял карточку после смены исполнителя при фильтре доски. */
export function useTaskDetail(
  taskUuid: string | null,
  options?: { enabled?: boolean; placeholderData?: Task | null },
) {
  const enabled = (options?.enabled ?? true) && !!taskUuid;

  return useQuery<Task>({
    queryKey: ['task', taskUuid],
    queryFn: async ({ signal }) => fetchTaskByUuid(taskUuid!, signal),
    enabled,
    staleTime: 15_000,
    /** Строка из списка при открытии; при пропаже задачи из отфильтрованного списка не затираем уже загруженный снимок. */
    placeholderData: (previousData) => previousData ?? options?.placeholderData ?? undefined,
    structuralSharing: false,
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
      queryClient.setQueriesData<TasksApiResponse>(
        { predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'tasks' },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            tasks: old.tasks.map((t) =>
              idEquals(t.uuid, uuid)
                ? {
                    ...t,
                    status,
                    completedAt: status === 'done' ? new Date().toISOString() : null,
                  }
                : t,
            ),
          };
        },
      );
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
  type: TaskType;
  dueDate: string;
  dueTime: string | null;
}>;

export type PatchTaskVariables = { uuid: string } & PatchTaskBody;

function stripPatchToApiBody(vars: PatchTaskVariables): PatchTaskBody {
  const { uuid: _u, ...body } = vars;
  return body;
}

/** Только поля из PATCH-тела без `undefined`, чтобы не затирать остальное (например assigneeId без dueDate). */
function patchDeltaFromVariables(vars: PatchTaskVariables): Partial<Task> {
  const body = stripPatchToApiBody(vars);
  return Object.fromEntries(
    Object.entries(body).filter(([, v]) => v !== undefined),
  ) as Partial<Task>;
}

function mergeTaskWithServerRow(prev: Task, server: Task): Task {
  return { ...prev, ...server };
}

export function usePatchTask() {
  const queryClient = useQueryClient();
  return useMutation<
    Task,
    Error,
    PatchTaskVariables,
    {
      snapshots: [QueryKey, TasksApiResponse | undefined][];
      detailSnapshot: Task | undefined;
      detailUuid: string;
    }
  >({
    mutationFn: async (vars: PatchTaskVariables) => {
      const { uuid } = vars;
      const body = stripPatchToApiBody(vars);
      const res = await apiClient.patch<{ data: Task }>(`/tasks/${uuid}`, body);
      const task = parseTaskFromPatchResponse(res);
      if (!task) {
        throw new Error('TASK_PATCH_EMPTY_RESPONSE');
      }
      return task;
    },
    onMutate: async (variables: PatchTaskVariables) => {
      const { uuid } = variables;
      const delta = patchDeltaFromVariables(variables);
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      await queryClient.cancelQueries({ queryKey: ['task', uuid] });
      const snapshots = queryClient.getQueriesData<TasksApiResponse>({ queryKey: ['tasks'] });
      const detailSnapshot = queryClient.getQueryData<Task>(['task', uuid]);
      if (detailSnapshot) {
        queryClient.setQueryData<Task>(['task', uuid], { ...detailSnapshot, ...delta });
      }
      queryClient.setQueriesData<TasksApiResponse>(
        { predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'tasks' },
        (old) => {
          if (!old?.tasks?.length) return old;
          const i = old.tasks.findIndex((t) => idEquals(t.uuid, uuid));
          if (i === -1) return old;
          const prev = old.tasks[i]!;
          const tasks = [...old.tasks];
          tasks[i] = { ...prev, ...delta };
          return { ...old, tasks };
        },
      );
      return { snapshots, detailSnapshot, detailUuid: uuid };
    },
    onError: (_err, variables, ctx) => {
      ctx?.snapshots?.forEach(([key, data]) => {
        if (data !== undefined) queryClient.setQueryData(key, data);
      });
      if (ctx?.detailUuid) {
        if (ctx.detailSnapshot !== undefined) {
          queryClient.setQueryData(['task', ctx.detailUuid], ctx.detailSnapshot);
        }
      }
    },
    onSuccess: async (updated, variables: PatchTaskVariables) => {
      const { uuid } = variables;
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      await queryClient.cancelQueries({ queryKey: ['task', uuid] });
      let final = updated;
      try {
        final = await fetchTaskByUuid(uuid);
      } catch {
        /* PATCH уже вернул DTO; GET нужен для assignee/имени после сохранения в БД */
      }
      queryClient.setQueriesData<TasksApiResponse>(
        { predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'tasks' },
        (old) => {
          if (!old?.tasks?.length) return old;
          const i = old.tasks.findIndex((t) => idEquals(t.uuid, uuid));
          if (i === -1) return old;
          const prev = old.tasks[i]!;
          const tasks = [...old.tasks];
          tasks[i] = mergeTaskWithServerRow(prev, final);
          return { ...old, tasks };
        },
      );
      queryClient.setQueryData<Task>(['task', uuid], (prev) =>
        prev ? mergeTaskWithServerRow(prev, final) : final,
      );
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
      const res = await apiClient.patch<{ data: Task }>(`/tasks/${uuid}/seen`);
      return { uuid, task: res.data.data };
    },
    onSuccess: ({ uuid, task }) => {
      /** Не invalidateQueries: полный refetch GET /tasks может завершиться после PATCH и перезатереть assignee/дедлайн. Достаточно подмешать «просмотрено». */
      queryClient.setQueriesData<TasksApiResponse>(
        { predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'tasks' },
        (old) => {
          if (!old?.tasks?.length) return old;
          const i = old.tasks.findIndex((t) => idEquals(t.uuid, uuid));
          if (i === -1) return old;
          const prev = old.tasks[i]!;
          const tasks = [...old.tasks];
          tasks[i] = {
            ...prev,
            lastManagerSeenAt: task.lastManagerSeenAt,
            unseenNotesCount: task.unseenNotesCount,
          };
          return { ...old, tasks };
        },
      );
      queryClient.setQueryData<Task>(['task', uuid], (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          lastManagerSeenAt: task.lastManagerSeenAt,
          unseenNotesCount: task.unseenNotesCount,
        };
      });
    },
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
      const photoUrls = res.data.data.photoUrls ?? [];
      if (files.length > 0 && photoUrls.length === 0) {
        throw new Error('TASK_PHOTO_UPLOAD_EMPTY');
      }
      return photoUrls;
    },
    onSuccess: async (photoUrls, { uuid }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      queryClient.setQueriesData<TasksApiResponse>(
        { predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'tasks' },
        (old) => {
          if (!old?.tasks?.length) return old;
          const i = old.tasks.findIndex((t) => idEquals(t.uuid, uuid));
          if (i === -1) return old;
          const prev = old.tasks[i]!;
          const tasks = [...old.tasks];
          tasks[i] = { ...prev, photoUrls };
          return { ...old, tasks };
        },
      );
    },
  });
}
