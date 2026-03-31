'use client';

import { AppShell } from '@/components/layout';
import { QueryProvider } from '@/components/providers/query-provider';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <QueryProvider>{children}</QueryProvider>
    </AppShell>
  );
}
