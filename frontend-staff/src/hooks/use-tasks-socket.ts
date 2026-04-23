'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { io } from 'socket.io-client';
import { apiClient } from '@/lib/api/client';
import { resolveSocketBaseUrl } from '@/lib/socket/resolve-socket-base-url';
import type { Task } from '@/hooks/use-tasks';

async function fetchWsToken(): Promise<string> {
  const res = await apiClient.post<{ data: { token: string } }>('/auth/ws-token', {});
  return res.data.data.token;
}

const STAFF_TASKS_QUERY_KEY = ['tasks', 'staff'] as const;
const STAFF_DELIVERY_ROUTE_KEY = ['tasks', 'staff-delivery-route'] as const;
const STAFF_DELIVERY_ROUTES_LIST_KEY = ['tasks', 'staff-delivery-routes'] as const;

export function useTasksSocket(staffUserId?: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const base = resolveSocketBaseUrl();

    const socket = io(`${base}/tasks`, {
      path: '/api/socket.io',
      withCredentials: true,
      auth: (cb) => {
        fetchWsToken()
          .then((token) => cb({ token }))
          .catch(() => cb({ token: '' }));
      },
      transports: ['websocket', 'polling'],
    });

    socket.on('checklist_item_updated', () => {
      void queryClient.invalidateQueries({ queryKey: STAFF_TASKS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['task-checklist'] });
    });

    socket.on('task_note_added', () => {
      void queryClient.invalidateQueries({ queryKey: STAFF_TASKS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['task-notes'] });
    });

    socket.on('incident_manager_note', (payload: { incidentId: string; text: string; reportedByUserId: string }) => {
      if (staffUserId && payload.reportedByUserId !== staffUserId) return;
      toast.info('Ответ менеджера по инциденту', { description: payload.text });
    });

    socket.on('delivery_route_assigned', (payload: { routeId: string; driverUserId: string }) => {
      if (staffUserId && payload.driverUserId !== staffUserId) return;
      void queryClient.invalidateQueries({ queryKey: STAFF_DELIVERY_ROUTE_KEY });
      void queryClient.invalidateQueries({ queryKey: STAFF_DELIVERY_ROUTES_LIST_KEY });
      void queryClient.invalidateQueries({ queryKey: STAFF_TASKS_QUERY_KEY });
      toast.info('Назначен маршрут доставки', { description: 'Откройте блок «Маршрут».' });
    });

    socket.on(
      'delivery_route_updated',
      (payload: { routeId: string; driverUserId: string | null; status: string }) => {
        if (staffUserId && payload.driverUserId && payload.driverUserId !== staffUserId) return;
        void queryClient.invalidateQueries({ queryKey: STAFF_DELIVERY_ROUTES_LIST_KEY });
        void queryClient.invalidateQueries({ queryKey: STAFF_DELIVERY_ROUTE_KEY });
      },
    );

    socket.on('task_updated', async () => {
      const before = new Set(
        (queryClient.getQueryData<{ tasks: Task[] }>(STAFF_TASKS_QUERY_KEY)?.tasks ?? []).map(
          (t) => t.uuid,
        ),
      );
      await queryClient.refetchQueries({ queryKey: STAFF_TASKS_QUERY_KEY });
      const after = queryClient.getQueryData<{ tasks: Task[] }>(STAFF_TASKS_QUERY_KEY)?.tasks ?? [];
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
  }, [queryClient, staffUserId]);
}
