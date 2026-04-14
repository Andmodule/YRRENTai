'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';
import type { Task, TasksApiResponse } from '../types';
import { SWIPE_FEEDBACK_TOAST_CLASSNAMES } from '../utils/swipe-feedback-toast';

const UNDO_MS = 4000;

function setTaskDoneInCaches(queryClient: ReturnType<typeof useQueryClient>, uuid: string) {
  queryClient.setQueriesData<TasksApiResponse>({ queryKey: ['tasks'] }, (old) => {
    if (!old || !old.tasks) return old;
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
  queryClient.setQueriesData<TasksApiResponse>({ queryKey: ['tasks'] }, (old) => {
    if (!old || !old.tasks) return old;
    return {
      ...old,
      tasks: old.tasks.map((t) => (t.uuid === snapshot.uuid ? snapshot : t)),
    };
  });
}

/**
 * Optimistic “done” in list + Sonner undo; PATCH only after toast window unless undone.
 */
export function usePendingTaskMarkDone(options: {
  taskMarkedMessage: string;
  undoLabel: string;
  markDoneErrorMessage: string;
}) {
  const queryClient = useQueryClient();
  const pendingRef = useRef<{
    uuid: string;
    snapshot: Task;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null>(null);

  const commitMarkDone = useCallback(
    async (uuid: string) => {
      try {
        await apiClient.patch<{ data: Task }>(`/tasks/${uuid}`, { status: 'done' });
        await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      } catch {
        toast.error(options.markDoneErrorMessage);
      }
    },
    [queryClient, options.markDoneErrorMessage],
  );

  const flushPending = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(p.timeoutId);
    pendingRef.current = null;
    void commitMarkDone(p.uuid);
  }, [commitMarkDone]);

  const enqueueMarkDoneAfterSwipe = useCallback(
    (task: Task) => {
      flushPending();

      const uuid = task.uuid;
      const snapshot = { ...task };

      setTaskDoneInCaches(queryClient, uuid);

      const timeoutId = setTimeout(() => {
        pendingRef.current = null;
        void commitMarkDone(uuid);
      }, UNDO_MS);

      pendingRef.current = { uuid, snapshot, timeoutId };

      toast(options.taskMarkedMessage, {
        duration: UNDO_MS,
        position: 'bottom-center',
        classNames: SWIPE_FEEDBACK_TOAST_CLASSNAMES,
        action: {
          label: options.undoLabel,
          onClick: () => {
            const cur = pendingRef.current;
            if (!cur || cur.uuid !== uuid) return;
            clearTimeout(cur.timeoutId);
            pendingRef.current = null;
            restoreTaskSnapshot(queryClient, cur.snapshot);
          },
        },
        onDismiss: () => {
          const cur = pendingRef.current;
          if (!cur || cur.uuid !== uuid) return;
          clearTimeout(cur.timeoutId);
          pendingRef.current = null;
          void commitMarkDone(uuid);
        },
      });
    },
    [commitMarkDone, flushPending, options.taskMarkedMessage, options.undoLabel, queryClient],
  );

  return { enqueueMarkDoneAfterSwipe };
}
