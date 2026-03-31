'use client';

import { AppShell } from '@/components/layout';
import { TasksSocketProvider } from '@/modules/tasks/providers/TasksSocketProvider';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <TasksSocketProvider>{children}</TasksSocketProvider>
    </AppShell>
  );
}
