'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';
import { parseChecklist422 } from '@/lib/is-checklist-422';
import type { Task } from '@/hooks/use-tasks';

type StaffTasksCache = { tasks: Task[] };

function setTaskDoneInCaches(queryClient: ReturnType<typeof useQueryClient>, uuid: string) {
  queryClient.setQueriesData<StaffTasksCache>({ queryKey: ['tasks', 'staff'] }, (old) => {
    if (!old) return old;
    const now = new Date().toISOString();
    return {
      ...old,
      tasks: old.tasks.map((t) =>
        t.uuid === uuid ? { ...t, status: 'done' as const, completedAt: now } : t,
      ),
    };
  });
}

function restoreTaskSnapshot(queryClient: ReturnType<typeof useQueryClient>, snapshot: Task) {
  queryClient.setQueriesData<StaffTasksCache>({ queryKey: ['tasks', 'staff'] }, (old) => {
    if (!old) return old;
    return {
      ...old,
      tasks: old.tasks.map((t) => (t.uuid === snapshot.uuid ? snapshot : t)),
    };
  });
}

function isAbortLike(e: unknown): boolean {
  if (isAxiosError(e) && (e.code === 'ERR_CANCELED' || e.name === 'CanceledError')) {
    return true;
  }
  if (e && typeof e === 'object' && 'name' in e && (e as { name: string }).name === 'AbortError') {
    return true;
  }
  return false;
}

export type PendingMarkDoneStaffOptions = {
  markDoneErrorMessage: string;
  onCommitted: (task: Task) => void;
  onChecklistIncomplete: (task: Task) => void;
};

/**
 * Оптимистично «готово» + сразу PATCH. Без тоста «Отмена» (раньше было ~6 с задержка).
 * Отмена: до ответа сервера `cancelPendingForUuid` (например, снятие «готово») — abort + откат.
 */
export function usePendingTaskMarkDoneStaff(options: PendingMarkDoneStaffOptions) {
  const queryClient = useQueryClient();
  const inFlightRef = useRef<Promise<void> | null>(null);
  const actRef = useRef<{
    uuid: string;
    snapshot: Task;
    ac: AbortController;
  } | null>(null);
  const optRef = useRef(options);
  optRef.current = options;

  const runCommit = useCallback(
    async (uuid: string, snapshot: Task, signal: AbortSignal) => {
      try {
        const res = await apiClient.patch<{ data: Task }>(`/tasks/${uuid}`, { status: 'done' }, { signal });
        const serverTask = res.data.data;
        await queryClient.invalidateQueries({ queryKey: ['tasks'] });
        optRef.current.onCommitted({ ...serverTask, status: 'done' });
      } catch (err: unknown) {
        if (isAbortLike(err) || (typeof AbortSignal !== 'undefined' && signal.aborted)) {
          return;
        }
        const checklistErr = parseChecklist422(err);
        if (checklistErr) {
          restoreTaskSnapshot(queryClient, snapshot);
          optRef.current.onChecklistIncomplete(snapshot);
          return;
        }
        restoreTaskSnapshot(queryClient, snapshot);
        toast.error(optRef.current.markDoneErrorMessage);
      }
    },
    [queryClient],
  );

  const flushInFlight = useCallback(async () => {
    const p = inFlightRef.current;
    if (p) {
      await p;
      inFlightRef.current = null;
    }
  }, []);

  const cancelPendingForUuid = useCallback(
    (uuid: string) => {
      const cur = actRef.current;
      if (!cur || cur.uuid !== uuid) return;
      cur.ac.abort();
      actRef.current = null;
      restoreTaskSnapshot(queryClient, cur.snapshot);
    },
    [queryClient],
  );

  const enqueueMarkDoneAfterSwipe = useCallback(
    (task: Task) => {
      void (async () => {
        await flushInFlight();
        const uuid = task.uuid;
        const snapshot = { ...task };
        const ac = new AbortController();
        setTaskDoneInCaches(queryClient, uuid);
        actRef.current = { uuid, snapshot, ac };

        const p = runCommit(uuid, snapshot, ac.signal)
          .finally(() => {
            inFlightRef.current = null;
            if (actRef.current?.uuid === uuid) {
              actRef.current = null;
            }
          });
        inFlightRef.current = p;
        await p;
      })();
    },
    [flushInFlight, queryClient, runCommit],
  );

  return { enqueueMarkDoneAfterSwipe, cancelPendingForUuid };
}
