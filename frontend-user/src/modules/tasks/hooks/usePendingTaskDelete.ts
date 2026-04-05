'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';
import type { Task, TasksApiResponse } from '../types';
import { SWIPE_FEEDBACK_TOAST_CLASSNAMES } from '../utils/swipe-feedback-toast';

const UNDO_MS = 4000;

function removeTaskFromCaches(queryClient: ReturnType<typeof useQueryClient>, uuid: string) {
  queryClient.setQueriesData<TasksApiResponse>({ queryKey: ['tasks'] }, (old) => {
    if (!old) return old;
    return { ...old, tasks: old.tasks.filter((t) => t.uuid !== uuid) };
  });
}

function restoreTaskInCaches(queryClient: ReturnType<typeof useQueryClient>, task: Task) {
  queryClient.setQueriesData<TasksApiResponse>({ queryKey: ['tasks'] }, (old) => {
    if (!old) return old;
    if (old.tasks.some((t) => t.uuid === task.uuid)) return old;
    return { ...old, tasks: [...old.tasks, task] };
  });
}

/**
 * Optimistic list removal + Sonner undo; DELETE only after toast window unless undone.
 */
export function usePendingTaskDelete(options: {
  taskDeletedMessage: string;
  undoLabel: string;
  deleteErrorMessage: string;
}) {
  const queryClient = useQueryClient();
  const pendingRef = useRef<{
    uuid: string;
    task: Task;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null>(null);

  const commitDelete = useCallback(
    async (uuid: string) => {
      try {
        await apiClient.delete(`/tasks/${uuid}`);
        await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      } catch {
        toast.error(options.deleteErrorMessage);
      }
    },
    [queryClient, options.deleteErrorMessage],
  );

  const flushPending = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(p.timeoutId);
    pendingRef.current = null;
    void commitDelete(p.uuid);
  }, [commitDelete]);

  const enqueueDeleteAfterSwipe = useCallback(
    (task: Task) => {
      flushPending();

      const uuid = task.uuid;
      removeTaskFromCaches(queryClient, uuid);

      const timeoutId = setTimeout(() => {
        pendingRef.current = null;
        void commitDelete(uuid);
      }, UNDO_MS);

      pendingRef.current = { uuid, task, timeoutId };

      toast(options.taskDeletedMessage, {
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
            restoreTaskInCaches(queryClient, cur.task);
          },
        },
        /** Toast closed (swipe/X/auto) without undo → commit delete immediately (same as timer expiry). */
        onDismiss: () => {
          const cur = pendingRef.current;
          if (!cur || cur.uuid !== uuid) return;
          clearTimeout(cur.timeoutId);
          pendingRef.current = null;
          void commitDelete(uuid);
        },
      });
    },
    [commitDelete, flushPending, options.taskDeletedMessage, options.undoLabel, queryClient],
  );

  return { enqueueDeleteAfterSwipe };
}
