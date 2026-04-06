'use client';

import { Suspense } from 'react';
import { Filter, Menu, Plus } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { TasksHeaderControls } from '@/modules/tasks/components/manager/TasksHeaderControls';
import { MobileTasksHeader } from '@/modules/tasks/components/ui/mobile-tasks-header';
import { useAuth } from '@/hooks/use-auth';
import { useUiStore } from '@/stores/ui.store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  tasksToolbarIconButtonBase,
  tasksToolbarIconButtonIdle,
} from '@/modules/tasks/task-toolbar-icon-button-classes';

export function Header() {
  const pathname = usePathname() ?? '';
  const { user } = useAuth();
  const tTasks = useTranslations('tasks');
  const tInbox = useTranslations('inbox');
  const tStaff = useTranslations('staff');
  const tCalendar = useTranslations('calendar');
  const tUnmapped = useTranslations('unmappedInbox');
  const tOpsNav = useTranslations('operations.nav');
  const tNav = useTranslations('nav');
  const tDashboard = useTranslations('dashboard');
  const tProperties = useTranslations('properties');
  const tSettings = useTranslations('settings');

  const isNewTaskPage = pathname.includes('/dashboard/tasks/new');
  const isTasksListPage =
    pathname.includes('/dashboard/tasks') && !isNewTaskPage;
  const isCalendar = pathname.includes('/dashboard/calendar');

  const { toggleSidebar, openCalendarFilter, propertyCreateHandler, staffInviteHandler } = useUiStore();

  const isPropertiesListPage = pathname.includes('/properties') && !/\/properties\/[^/]+/.test(pathname);
  const isStaffPage = pathname.includes('/dashboard/staff');
  const canUseStaffInvite = user?.role === 'OWNER' || user?.role === 'MANAGER';

  /**
   * Заголовок страницы в центре шапки.
   * Порядок важен: специфичные пути раньше общих (/dashboard/X до /dashboard).
   */
  const shellPageTitle = (() => {
    if (pathname.includes('/chat')) return tInbox('title');
    if (isCalendar) return tCalendar('title');
    if (pathname.includes('/dashboard/staff')) return tStaff('title');
    if (pathname.includes('/dashboard/unmapped')) return tUnmapped('title');
    if (pathname.includes('/dashboard/operations')) return tOpsNav('title');
    if (pathname.includes('/dashboard/incidents')) return tNav('incidents');
    if (pathname.includes('/kb-improvement')) return tNav('kbImprovement');
    if (pathname.includes('/settings')) return tSettings('title');
    if (pathname.includes('/properties')) return tProperties('title');
    if (/\/dashboard\/?$/.test(pathname)) return tDashboard('title');
    return null;
  })();

  const headerShell =
    'sticky top-0 z-30 shrink-0 border-b border-slate-200 bg-background/95 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/85';

  /** Tasks list: mobile — Telegram-style single row + kebab; desktop — two rows + toolbar */
  if (isTasksListPage) {
    return (
      <header className={cn(headerShell, 'flex flex-col')}>
        <div className="lg:hidden">
          <MobileTasksHeader title={tTasks('pageTitle')} />
        </div>
        <div className="hidden lg:flex lg:flex-col">
          <div className="grid h-11 grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 sm:h-12 sm:px-4">
            <div className="flex justify-start" />
            <h1 className="truncate text-center text-lg font-semibold tracking-tight text-foreground">
              {tTasks('pageTitle')}
            </h1>
            <div className="flex justify-end" aria-hidden />
          </div>
          <div className="flex w-full items-center border-t border-border/40">
            <Suspense
              fallback={<div className="h-14 w-full shrink animate-pulse bg-muted/20 px-4 py-2" aria-hidden />}
            >
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
        'grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 sm:h-16 sm:px-6',
      )}
    >
      {/* Left: burger on mobile only */}
      <div className="flex justify-start">
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

      {/* Center: page title */}
      <div className="flex min-w-0 max-w-full justify-center">
        {isNewTaskPage ? (
          <h1 className="truncate text-center text-base font-semibold tracking-tight sm:text-lg">
            {tTasks('newFromBooking.title')}
          </h1>
        ) : shellPageTitle ? (
          <h1 className="truncate text-center text-lg font-semibold tracking-tight text-foreground">
            {shellPageTitle}
          </h1>
        ) : null}
      </div>

      {/* Right: календарь — фильтр; объекты/персонал — «+» */}
      <div className="flex justify-end">
        {isCalendar && (
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label={tCalendar('filters')}
            onClick={() => openCalendarFilter?.()}
          >
            <Filter className="h-5 w-5" />
          </Button>
        )}
        {!isCalendar && isPropertiesListPage && propertyCreateHandler ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(tasksToolbarIconButtonBase, tasksToolbarIconButtonIdle)}
            aria-label={tProperties('addProperty')}
            onClick={() => propertyCreateHandler()}
          >
            <Plus className="h-4 w-4" aria-hidden />
          </Button>
        ) : null}
        {!isCalendar && !isPropertiesListPage && isStaffPage && canUseStaffInvite && staffInviteHandler ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(tasksToolbarIconButtonBase, tasksToolbarIconButtonIdle)}
            aria-label={tStaff('addStaff')}
            onClick={() => staffInviteHandler()}
          >
            <Plus className="h-4 w-4" aria-hidden />
          </Button>
        ) : null}
      </div>
    </header>
  );
}
