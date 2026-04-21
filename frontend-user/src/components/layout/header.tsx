'use client';

import { Suspense } from 'react';
import { Filter, Menu, Plus, Search } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { TasksHeaderControls } from '@/modules/tasks/components/manager/TasksHeaderControls';
import { MobileTasksHeader } from '@/modules/tasks/components/ui/mobile-tasks-header';
import { useAuth } from '@/hooks/use-auth';
import { useUiStore } from '@/stores/ui.store';
import { useInboxSearchStore } from '@/stores/inbox-search.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  tasksToolbarIconButtonBase,
  tasksToolbarIconButtonActive,
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
  const isChatPage = pathname.includes('/chat');

  const inboxSearchOpen = useInboxSearchStore((s) => s.searchOpen);
  const inboxQuery = useInboxSearchStore((s) => s.query);
  const setInboxQuery = useInboxSearchStore((s) => s.setQuery);
  const toggleInboxSearch = useInboxSearchStore((s) => s.toggleSearch);
  const inboxSearchActive = inboxSearchOpen || inboxQuery.trim().length > 0;

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
        <div className="hidden lg:flex lg:flex-col border-b border-border/40">
          <Suspense
            fallback={<div className="h-11 w-full shrink animate-pulse bg-muted/20 sm:h-12" aria-hidden />}
          >
            <div className="tasks-theme min-w-0">
              <TasksHeaderControls layout="headerDesktopGrid" desktopPageTitle={tTasks('pageTitle')} />
            </div>
          </Suspense>
        </div>
      </header>
    );
  }

  if (isChatPage) {
    return (
      <header
        className={cn(
          headerShell,
          /* На мобайле шапку даёт `ChatMobileNav` (fixed); этот блок в потоке давал пустую полосу ~h-14 под ней. */
          'hidden flex-col lg:flex',
        )}
      >
        <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 sm:h-16 sm:px-6">
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
          <div className="flex min-w-0 max-w-full justify-center">
            <h1 className="truncate text-center text-lg font-semibold tracking-tight text-foreground">
              {tInbox('title')}
            </h1>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                tasksToolbarIconButtonBase,
                'hidden lg:flex',
                inboxSearchActive ? tasksToolbarIconButtonActive : tasksToolbarIconButtonIdle,
              )}
              aria-label={tInbox('searchToggleAria')}
              aria-expanded={inboxSearchOpen}
              aria-pressed={inboxSearchOpen}
              onClick={() => toggleInboxSearch()}
            >
              <Search className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
        {inboxSearchOpen ? (
          <div className="hidden border-t border-border/40 px-4 pb-3 pt-2 sm:px-6 lg:block">
            <div className="relative min-w-0">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={inboxQuery}
                onChange={(e) => setInboxQuery(e.target.value)}
                placeholder={tInbox('searchPlaceholder')}
                className="h-9 border-border/60 bg-muted/20 py-0 pl-8 pr-2 text-sm"
                aria-label={tInbox('searchToggleAria')}
                autoFocus
              />
            </div>
          </div>
        ) : null}
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
