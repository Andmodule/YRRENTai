'use client';

import { TasksSocketProvider } from '@/modules/tasks/providers/TasksSocketProvider';
import { TmaLayoutRoot } from '@/modules/tma/components/TmaLayoutRoot';

export default function TmaLayout({ children }: { children: React.ReactNode }) {
  return (
    <TasksSocketProvider>
      <TmaLayoutRoot>{children}</TmaLayoutRoot>
    </TasksSocketProvider>
  );
}
