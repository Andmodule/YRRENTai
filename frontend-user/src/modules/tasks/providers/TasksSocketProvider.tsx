'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { connectTasksSocket } from '@/lib/socket/tasks-socket';

/**
 * Subscribes to `task_updated` and invalidates React Query `['tasks']`.
 * Does not expose the Socket instance — consumers use useTasks/useQuery only.
 */
export function TasksSocketProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const t = useTranslations('tasks');

  useEffect(() => {
    /** Только маршруты — тяжёлый список; матрицу и ленту разбора обновляем сразу без «пустого» окна после LLM. */
    let deliveryRoutesDebounce: ReturnType<typeof setTimeout> | null = null;
    const socket = connectTasksSocket();
    socket.on('task_updated', () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task'] });
    });
    socket.on('task_note_added', () => {
      toast.info('Новая заметка по задаче', { description: 'Откройте карточку, чтобы прочитать.' });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task'] });
      queryClient.invalidateQueries({ queryKey: ['task-notes'] });
    });
    socket.on('checklist_item_updated', () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task'] });
    });
    socket.on('incident_created', () => {
      toast.info(t('incidentSocketToastTitle'), {
        description: t('incidentSocketToastDescription'),
      });
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['incidents-open-count'] });
    });
    socket.on('incident_updated', () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['incidents-open-count'] });
    });
    socket.on('supply_interpretations_changed', () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-interpretations'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-matrix', 'rows'] });
      if (deliveryRoutesDebounce) clearTimeout(deliveryRoutesDebounce);
      deliveryRoutesDebounce = setTimeout(() => {
        deliveryRoutesDebounce = null;
        void queryClient.invalidateQueries({
          queryKey: ['tasks', 'manager-delivery-routes', 'list'],
        });
      }, 2200);
    });
    return () => {
      if (deliveryRoutesDebounce) clearTimeout(deliveryRoutesDebounce);
      socket.disconnect();
    };
  }, [queryClient, t]);

  return <>{children}</>;
}
