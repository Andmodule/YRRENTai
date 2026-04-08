'use client';

/**
 * Legacy Mini App shell (Kanban-стиль задач в frontend-user).
 * Основной Staff Mini App: отдельное приложение `frontend-staff` + `TELEGRAM_STAFF_MINI_APP_URL`.
 */
import { TasksSocketProvider } from '@/modules/tasks/providers/TasksSocketProvider';
import { TmaLayoutRoot } from '@/modules/tma/components/TmaLayoutRoot';

export default function TmaLayout({ children }: { children: React.ReactNode }) {
  return (
    <TasksSocketProvider>
      <TmaLayoutRoot>{children}</TmaLayoutRoot>
    </TasksSocketProvider>
  );
}
