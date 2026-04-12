'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';
import { parseChecklist422 } from '@/lib/is-checklist-422';
import { STAFF_UNDO_TOAST_CLASSNAMES } from '@/lib/staff-undo-toast';
import type { Task } from '@/hooks/use-tasks';

/** Менеджер: 4000 ms; staff: +2 с на отмену. */
const UNDO_MS = 6000;

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

export type PendingMarkDoneStaffOptions = {
  taskMarkedMessage: string;
  undoLabel: string;
  markDoneErrorMessage: string;
  onCommitted: (task: Task) => void;
  onChecklistIncomplete: (task: Task) => void;
};

/**
 * Оптимистично «готово» в списке + Sonner «Отмена»; PATCH после окна, если не отменили.
 * Тайминг дольше, чем у менеджера (4 с → 6 с).
 */
export function usePendingTaskMarkDoneStaff(options: PendingMarkDoneStaffOptions) {
  const queryClient = useQueryClient();
  const pendingRef = useRef<{
    uuid: string;
    snapshot: Task;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null>(null);
  const optRef = useRef(options);
  optRef.current = options;

  const commitMarkDone = useCallback(async (uuid: string, snapshot: Task) => {
    try {
      await apiClient.patch<{ data: Task }>(`/tasks/${uuid}`, { status: 'done' });
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      optRef.current.onCommitted(snapshot);
    } catch (err: unknown) {
      const checklistErr = parseChecklist422(err);
      if (checklistErr) {
        restoreTaskSnapshot(queryClient, snapshot);
        optRef.current.onChecklistIncomplete(snapshot);
        return;
      }
      restoreTaskSnapshot(queryClient, snapshot);
      toast.error(optRef.current.markDoneErrorMessage);
    }
  }, [queryClient]);

  const flushPending = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(p.timeoutId);
    pendingRef.current = null;
    void commitMarkDone(p.uuid, p.snapshot);
  }, [commitMarkDone]);

  const enqueueMarkDoneAfterSwipe = useCallback(
    (task: Task) => {
      flushPending();

      const uuid = task.uuid;
      const snapshot = { ...task };

      setTaskDoneInCaches(queryClient, uuid);

      const timeoutId = setTimeout(() => {
        const cur = pendingRef.current;
        if (!cur || cur.uuid !== uuid) return;
        pendingRef.current = null;
        void commitMarkDone(uuid, snapshot);
      }, UNDO_MS);

      pendingRef.current = { uuid, snapshot, timeoutId };

      toast(optRef.current.taskMarkedMessage, {
        duration: UNDO_MS,
        position: 'bottom-center',
        classNames: STAFF_UNDO_TOAST_CLASSNAMES,
        action: {
          label: optRef.current.undoLabel,
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
          void commitMarkDone(uuid, snapshot);
        },
      });
    },
    [commitMarkDone, flushPending, queryClient],
  );

  return { enqueueMarkDoneAfterSwipe };
}
