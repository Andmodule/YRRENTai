'use client';

import { Suspense } from 'react';
import { Menu, LogOut, User } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { TasksHeaderControls } from '@/modules/tasks/components/manager/TasksHeaderControls';
import { MobileTasksHeader } from '@/modules/tasks/components/ui/mobile-tasks-header';
import { useUiStore } from '@/stores/ui.store';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api/client';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function Header() {
  const pathname = usePathname();
  const tTasks = useTranslations('tasks');
  const isChat = pathname?.includes('/chat');
  const isNewTaskPage = pathname?.includes('/dashboard/tasks/new');
  const isTasksListPage =
    pathname?.includes('/dashboard/tasks') && !pathname?.includes('/dashboard/tasks/new');
  const { toggleSidebar } = useUiStore();
  const { user, mutate } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    try {
      await apiClient.post('/auth/logout');
      await mutate(undefined, false);
      router.replace('/login');
    } catch {
      toast.error('Logout failed');
    }
  }

  const headerShell =
    'sticky top-0 z-30 shrink-0 border-b border-slate-200 bg-background/95 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/85';

  /** Tasks list: mobile — Telegram-style single row + kebab; desktop — two rows + toolbar */
  if (isTasksListPage) {
    return (
      <header
        className={cn(
          /* Как на остальных экранах дашборда (staff и т.д.): тот же headerShell, без отдельной «заливки» задач */
          headerShell,
          'flex flex-col',
          isChat && 'hidden lg:flex',
        )}
      >
        <div className="lg:hidden">
          <MobileTasksHeader title={tTasks('pageTitle')} />
        </div>

        <div className="hidden lg:flex lg:flex-col">
          <div className="flex h-11 items-center gap-2 px-3 sm:h-12 sm:px-4">
            <div className="flex min-w-0 flex-1 justify-start">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                className="lg:hidden text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Toggle sidebar"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </div>
            <h1 className="shrink-0 text-base font-semibold tracking-tight">{tTasks('pageTitle')}</h1>
            <div className="flex min-w-0 flex-1 justify-end">
              {user ? (
                <div className="hidden items-center gap-0.5 sm:gap-1 lg:flex">
                  <ThemeToggle />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleLogout}
                    aria-label="Sign out"
                    className="text-slate-400 hover:bg-slate-800 hover:text-white"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex w-full items-center border-t border-border/40">
            <Suspense
              fallback={<div className="h-14 w-full shrink animate-pulse bg-muted/20 px-4 py-2" aria-hidden />}
            >
              {/* Teal accent только у тулбара — не на всей шапке (иначе --ring/--primary дают «неон» по краю) */}
              <div className="tasks-theme min-w-0 flex-1">
                <TasksHeaderControls />
              </div>
            </Suspense>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header
      className={cn(
        headerShell,
        'flex h-14 items-center gap-2 sm:h-16 sm:gap-4',
        'px-4 sm:px-6',
        isChat && 'hidden lg:flex',
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSidebar}
        className="lg:hidden text-slate-400 hover:bg-slate-800 hover:text-white"
        aria-label="Toggle sidebar"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {isNewTaskPage ? (
          <h1 className="truncate text-left text-base font-semibold tracking-tight">{tTasks('newFromBooking.title')}</h1>
        ) : null}
      </div>

      {user && (
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2.5 sm:flex">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 bg-primary/15 text-primary">
              <User className="h-4 w-4" />
            </div>
            <div className="hidden flex-col md:flex">
              <span className="text-sm font-medium leading-none text-slate-200">
                {user.firstName} {user.lastName}
              </span>
              <span className="mt-0.5 text-xs text-slate-500">{user.email}</span>
            </div>
          </div>

          <div className="hidden items-center gap-2 lg:flex">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              aria-label="Sign out"
              className="text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
