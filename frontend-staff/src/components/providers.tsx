'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TelegramStaffGate } from '@/components/auth/telegram-staff-gate';
import { StaffErrorBoundary } from '@/components/staff-error-boundary';
import { StaffStringsProvider } from '@/locales/staff-strings';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1 },
        },
      }),
  );

  return (
    <StaffErrorBoundary>
      <QueryClientProvider client={client}>
        <StaffStringsProvider>
          <TelegramStaffGate>{children}</TelegramStaffGate>
        </StaffStringsProvider>
      </QueryClientProvider>
    </StaffErrorBoundary>
  );
}
