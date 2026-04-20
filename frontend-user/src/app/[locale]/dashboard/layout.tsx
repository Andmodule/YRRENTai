'use client';

import { AppShell } from '@/components/layout';
import { CalendarSocketProvider } from '@/modules/calendar/providers/CalendarSocketProvider';
import { TasksSocketProvider } from '@/modules/tasks/providers/TasksSocketProvider';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <TasksSocketProvider>
        <CalendarSocketProvider>{children}</CalendarSocketProvider>
      </TasksSocketProvider>
    </AppShell>
  );
}
