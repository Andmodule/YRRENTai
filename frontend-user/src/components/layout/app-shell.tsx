'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { APP_SHELL_GRADIENT_DARK } from './shell-background';
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
      <div className="flex min-h-screen bg-background dark:bg-slate-900">
        <div className="hidden w-56 shrink-0 border-r border-slate-800 lg:block">
          <div className="flex h-16 items-center border-b border-slate-800 px-6">
            <div className="h-6 w-24 rounded-md bg-slate-800 animate-pulse" />
          </div>
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-9 w-full rounded-md bg-slate-800 animate-pulse" />
            ))}
          </div>
        </div>
        <div className="flex flex-1 flex-col">
          <div className="flex h-16 items-center border-b border-slate-800 px-6">
            <div className="ml-auto h-8 w-32 rounded-md bg-slate-800 animate-pulse" />
          </div>
          <div className="flex flex-col gap-4 p-6">
            <div className="h-8 w-48 rounded-md bg-slate-800 animate-pulse" />
            <div className="h-48 w-full rounded-xl bg-slate-800 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return <AppShellContent>{children}</AppShellContent>;
}

function AppShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isChat = pathname?.includes('/chat');
  /** Tasks board: header + filters stay fixed; list scrolls inside main (same height lock as chat). */
  const isTasksBoardPage =
    pathname?.includes('/dashboard/tasks') && !pathname?.includes('/dashboard/tasks/new');
  const lockViewportColumn = isChat || isTasksBoardPage;

  return (
    <div className={cn('flex min-h-screen overflow-x-hidden bg-background', APP_SHELL_GRADIENT_DARK)}>
      <Sidebar />
      <div
        className={cn(
          /* min-w-0: flex-элемент иначе не сужается ниже ширины контента → горизонтальный скролл всей страницы */
          'flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-x-hidden lg:ml-56',
          /* Явная высота viewport — иначе h-full у детей = 0 и не работает скролл/поле ввода */
          lockViewportColumn ? 'h-dvh max-h-dvh overflow-hidden' : 'min-h-screen',
        )}
      >
        <Header />
        <main
          className={cn(
            'min-w-0 flex-1',
            isChat
              ? /* overflow-hidden на всех ширинах — иначе ломается flex-скролл и поле ввода уезжает за viewport */
                'flex min-h-0 flex-col overflow-hidden p-0 lg:p-6'
              : isTasksBoardPage
                ? 'flex min-h-0 min-w-0 flex-col overflow-hidden p-4 sm:p-6'
                : /* overflow-x-hidden: широкий тулбар/сетка не расширяют viewport по X */
                  'flex min-h-0 min-w-0 flex-col overflow-x-hidden p-4 sm:p-6',
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
