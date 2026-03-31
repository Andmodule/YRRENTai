'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { connectTasksSocket } from '@/lib/socket/tasks-socket';

/**
 * Subscribes to `task_updated` and invalidates React Query `['tasks']`.
 * Does not expose the Socket instance — consumers use useTasks/useQuery only.
 */
export function TasksSocketProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = connectTasksSocket();
    socket.on('task_updated', () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    });
    socket.on('task_note_added', () => {
      toast.info('Новая заметка по задаче', { description: 'Откройте карточку, чтобы прочитать.' });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task-notes'] });
    });
    return () => {
      socket.disconnect();
    };
  }, [queryClient]);

  return <>{children}</>;
}
