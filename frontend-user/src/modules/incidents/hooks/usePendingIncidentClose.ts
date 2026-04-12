'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';
import { SWIPE_FEEDBACK_TOAST_CLASSNAMES } from '@/modules/tasks/utils/swipe-feedback-toast';
import type { Incident } from './useIncidents';

const UNDO_MS = 4000;

function setIncidentResolvedInCaches(queryClient: ReturnType<typeof useQueryClient>, uuid: string) {
  queryClient.setQueryData<Incident[]>(['incidents'], (old) => {
    if (!old) return old;
    return old.map((i) => (i.uuid === uuid ? { ...i, status: 'resolved' as const } : i));
  });
}

function restoreIncidentSnapshot(queryClient: ReturnType<typeof useQueryClient>, snapshot: Incident) {
  queryClient.setQueryData<Incident[]>(['incidents'], (old) => {
    if (!old) return old;
    return old.map((i) => (i.uuid === snapshot.uuid ? snapshot : i));
  });
}

/**
 * Optimistic resolve in list + Sonner undo; PATCH `resolved` after toast window unless undone.
 * Same outcome as drawer «Решено» — avoids a separate «closed» path in the UI.
 */
export function usePendingIncidentClose(options: {
  incidentClosedMessage: string;
  undoLabel: string;
  closeErrorMessage: string;
}) {
  const queryClient = useQueryClient();
  const pendingRef = useRef<{
    uuid: string;
    snapshot: Incident;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null>(null);

  const commitClose = useCallback(
    async (uuid: string) => {
      try {
        await apiClient.patch<{ data: { incident: Incident } }>(`/incidents/${uuid}`, {
          status: 'resolved',
        });
        await queryClient.invalidateQueries({ queryKey: ['incidents'] });
        await queryClient.invalidateQueries({ queryKey: ['incidents-open-count'] });
      } catch {
        toast.error(options.closeErrorMessage);
      }
    },
    [queryClient, options.closeErrorMessage],
  );

  const flushPending = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(p.timeoutId);
    pendingRef.current = null;
    void commitClose(p.uuid);
  }, [commitClose]);

  const enqueueCloseAfterSwipe = useCallback(
    (incident: Incident) => {
      flushPending();

      const uuid = incident.uuid;
      const snapshot = { ...incident };

      setIncidentResolvedInCaches(queryClient, uuid);

      const timeoutId = setTimeout(() => {
        pendingRef.current = null;
        void commitClose(uuid);
      }, UNDO_MS);

      pendingRef.current = { uuid, snapshot, timeoutId };

      toast(options.incidentClosedMessage, {
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
            restoreIncidentSnapshot(queryClient, cur.snapshot);
          },
        },
        onDismiss: () => {
          const cur = pendingRef.current;
          if (!cur || cur.uuid !== uuid) return;
          clearTimeout(cur.timeoutId);
          pendingRef.current = null;
          void commitClose(uuid);
        },
      });
    },
    [commitClose, flushPending, options.incidentClosedMessage, options.undoLabel, queryClient],
  );

  return { enqueueCloseAfterSwipe };
}
