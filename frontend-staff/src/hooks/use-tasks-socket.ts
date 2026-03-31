'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { io } from 'socket.io-client';
import { apiClient } from '@/lib/api/client';
import { resolveSocketBaseUrl } from '@/lib/socket/resolve-socket-base-url';
import type { Task } from '@/hooks/use-tasks';

async function fetchWsToken(): Promise<string> {
  const res = await apiClient.post<{ data: { token: string } }>('/auth/ws-token', {});
  return res.data.data.token;
}

export function useTasksSocket(staffUserId?: string) {
  const queryClient = useQueryClient();
  const today = format(new Date(), 'yyyy-MM-dd');

  useEffect(() => {
    const base = resolveSocketBaseUrl();
    const sameOrigin =
      typeof window !== 'undefined' && base === window.location.origin;

    const socket = io(`${base}/tasks`, {
      path: '/api/socket.io',
      withCredentials: true,
      auth: (cb) => {
        fetchWsToken()
          .then((token) => cb({ token }))
          .catch(() => cb({ token: '' }));
      },
      transports: sameOrigin ? ['polling', 'websocket'] : ['websocket', 'polling'],
    });

    socket.on('checklist_item_updated', () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', today] });
      void queryClient.invalidateQueries({ queryKey: ['task-checklist'] });
    });

    socket.on('incident_manager_note', (payload: { incidentId: string; text: string; reportedByUserId: string }) => {
      if (staffUserId && payload.reportedByUserId !== staffUserId) return;
      toast.info('Ответ менеджера по инциденту', { description: payload.text });
    });

    socket.on('task_updated', async () => {
      const key = ['tasks', today] as const;
      const before = new Set(
        (queryClient.getQueryData<{ tasks: Task[] }>(key)?.tasks ?? []).map((t) => t.uuid),
      );
      await queryClient.refetchQueries({ queryKey: ['tasks', today] });
      const after = queryClient.getQueryData<{ tasks: Task[] }>(key)?.tasks ?? [];
      const newOnes = after.filter((t) => !before.has(t.uuid));
      if (newOnes.length === 0) return;
      if (before.size === 0 && newOnes.length === after.length && after.length > 1) return;
      for (const t of newOnes) {
        if (t.priority === 'urgent') {
          toast.error('Срочная задача', { description: t.propertyTitle });
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([200, 100, 200]);
          }
        } else {
          toast.info('Новая задача', { description: t.propertyTitle });
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([200]);
          }
        }
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [queryClient, today, staffUserId]);
}
