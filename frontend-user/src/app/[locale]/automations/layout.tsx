'use client';

import { AppShell } from '@/components/layout';
import { AutomationsSubNav } from '@/components/automations/AutomationsSubNav';

export default function AutomationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <div className="flex min-h-0 w-full flex-1 flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
        <AutomationsSubNav />
        <div className="min-h-0 min-w-0 flex-1">{children}</div>
      </div>
    </AppShell>
  );
}
