'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui.store';
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
      <div className="flex min-h-screen bg-background">
        <div className="hidden w-56 shrink-0 border-r border-border lg:block dark:border-slate-800">
          <div className="flex h-16 items-center border-b border-border px-6 dark:border-slate-800">
            <div className="h-6 w-24 animate-pulse rounded-md bg-muted dark:bg-slate-800" />
          </div>
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-9 w-full animate-pulse rounded-md bg-muted dark:bg-slate-800" />
            ))}
          </div>
        </div>
        <div className="flex flex-1 flex-col">
          <div className="flex h-16 items-center border-b border-border px-6 dark:border-slate-800">
            <div className="ml-auto h-8 w-32 animate-pulse rounded-md bg-muted dark:bg-slate-800" />
          </div>
          <div className="flex flex-col gap-4 p-6">
            <div className="h-8 w-48 animate-pulse rounded-md bg-muted dark:bg-slate-800" />
            <div className="h-48 w-full animate-pulse rounded-xl bg-muted dark:bg-slate-800" />
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
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const isChat = pathname?.includes('/chat');
  /** Tasks board: header + filters stay fixed; list scrolls inside main (same height lock as chat). */
  const isTasksBoardPage =
    pathname?.includes('/dashboard/tasks') && !pathname?.includes('/dashboard/tasks/new');
  /** Calendar: filter strip + timeline fixed; Planby grid scrolls inside main. */
  const isCalendarPage = pathname?.includes('/dashboard/calendar');
  const lockViewportColumn = isChat || isTasksBoardPage || isCalendarPage;

  return (
    <div className={cn('flex min-h-screen overflow-x-hidden bg-background', APP_SHELL_GRADIENT_DARK)}>
      <Sidebar />
      <div
        className={cn(
          /* min-w-0: flex-элемент иначе не сужается ниже ширины контента → горизонтальный скролл всей страницы */
          'flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-x-hidden transition-[margin] duration-500 ease-[cubic-bezier(0.33,1,0.68,1)] motion-reduce:duration-300',
          sidebarCollapsed ? 'lg:ml-[4.5rem]' : 'lg:ml-56',
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
                'flex min-h-0 flex-col overflow-hidden p-0 pl-[max(0px,env(safe-area-inset-left,0px))] pr-[max(0px,env(safe-area-inset-right,0px))] lg:p-6'
              : isTasksBoardPage
                ? /* мобайл: меньше пустоты между шапкой и фильтрами; safe-area для вырезов iPhone */
                  'flex min-h-0 min-w-0 flex-col overflow-hidden pt-1 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] sm:pt-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] sm:pl-6 sm:pr-6'
                : isCalendarPage
                  ? /* календарь: минимальный зазор под sticky-шапкой приложения; скролл только у сетки внутри CalendarView */
                    'flex min-h-0 min-w-0 flex-col overflow-hidden pt-0 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] sm:pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] sm:pl-6 sm:pr-6'
                  : /* overflow-x-hidden: широкий тулбар/сетка не расширяют viewport по X */
                    'flex min-h-0 min-w-0 flex-col overflow-x-hidden pt-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] sm:pt-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] sm:pl-6 sm:pr-6',
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
