'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Sidebar } from './sidebar';
import { Header } from './header';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading || user) return;
    router.replace('/login');
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen">
        <div className="hidden w-56 shrink-0 border-r lg:block">
          <div className="flex h-16 items-center border-b px-6">
            <Skeleton className="h-6 w-24" />
          </div>
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </div>
        <div className="flex flex-1 flex-col">
          <div className="flex h-16 items-center border-b px-6">
            <Skeleton className="ml-auto h-8 w-32" />
          </div>
          <div className="flex flex-col gap-4 p-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <AppShellContent>{children}</AppShellContent>
  );
}

function AppShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isChat = pathname?.includes('/chat');

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col lg:ml-56',
          isChat && 'min-h-[100dvh] lg:min-h-screen',
        )}
      >
        <Header />
        <main
          className={cn(
            'min-w-0 flex-1',
            isChat
              ? 'flex min-h-0 flex-col overflow-hidden p-0 lg:overflow-visible lg:p-6'
              : 'p-6',
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
