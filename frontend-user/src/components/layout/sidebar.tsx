'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useUiStore } from '@/stores/ui.store';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/hooks/use-media-query';
import {
  ChevronLeft,
  LayoutDashboard,
  Building2,
  LayoutGrid,
  ListTodo,
  LogOut,
  MessageSquare,
  Phone,
  Settings,
  Sparkles,
  Users,
  Warehouse,
} from 'lucide-react';
import { useOpenIncidentsCount } from '@/modules/incidents/hooks/useIncidents';
import { useChatNeedsHumanPending } from '@/hooks/use-conversations';
import { useCallsNavBadge } from '@/hooks/use-calls-admin';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';

const navItems = [
  { href: '/dashboard',           icon: LayoutDashboard, key: 'dashboard',     roles: null },
  { href: '/properties',          icon: Building2,       key: 'properties',    roles: null },
  { href: '/dashboard/tasks',     icon: ListTodo,        key: 'tasks',         roles: null },
  { href: '/dashboard/staff',     icon: Users,           key: 'staff',         roles: null },
  { href: '/dashboard/operations',icon: Warehouse,       key: 'operations',    roles: null },
  { href: '/dashboard/calendar',  icon: LayoutGrid,      key: 'calendar',      roles: null },
  { href: '/chat',                icon: MessageSquare,   key: 'chat',          roles: null },
  { href: '/dashboard/calls',     icon: Phone,           key: 'calls',         roles: ['OWNER', 'MANAGER'] as const },
  { href: '/kb-improvement',      icon: Sparkles,        key: 'kbImprovement', roles: null },
  { href: '/settings/profile',    icon: Settings,        key: 'settings',      roles: null },
] as const;

/** When `NEXT_PUBLIC_NAV_LIMITED_MODE=true`, only these keys stay clickable; others are shown but disabled. */
const NAV_LIMITED_ALLOWED_KEYS = new Set<string>(['dashboard', 'properties', 'tasks', 'staff', 'chat']);
const navLimitedMode =
  process.env.NEXT_PUBLIC_NAV_LIMITED_MODE?.trim().toLowerCase() === 'true';

export function Sidebar() {
  const t = useTranslations('nav');
  const tAuth = useTranslations('auth');
  const router = useRouter();
  const isLg = useMediaQuery('(min-width: 1024px)');
  const { sidebarOpen, setSidebarOpen, sidebarCollapsed, toggleSidebarCollapsed } = useUiStore();
  const showCollapsedChrome = Boolean(sidebarCollapsed && isLg);
  const pathname = usePathname();
  const { data: openIncidents = 0 } = useOpenIncidentsCount();
  const chatNeedsHuman = useChatNeedsHumanPending();
  const { user, mutate } = useAuth();
  const isCallsAdmin = user?.role === 'OWNER' || user?.role === 'MANAGER';
  const callsBadge = useCallsNavBadge(isCallsAdmin);

  async function handleLogout() {
    try {
      await apiClient.post('/auth/logout');
      await mutate(undefined, false);
      setSidebarOpen(false);
      router.replace('/login');
    } catch {
      toast.error('Logout failed');
    }
  }

  return (
    <TooltipProvider delayDuration={200}>
      {/* Mobile: всегда в DOM — плавный fade при закрытии (раньше overlay пропадал мгновенно) */}
      <div
        className={cn(
          'fixed inset-0 z-40 lg:hidden',
          'transition-[opacity,backdrop-filter] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]',
          'motion-reduce:transition-opacity motion-reduce:duration-200',
          sidebarOpen
            ? 'cursor-pointer bg-black/50 opacity-100 backdrop-blur-[8px]'
            : 'pointer-events-none opacity-0 backdrop-blur-none',
        )}
        aria-hidden
        onClick={() => setSidebarOpen(false)}
      />

      <aside
        className={cn(
          'fixed left-0 top-0 z-50 flex h-screen w-56 flex-col',
          'overflow-hidden border-r border-slate-800 bg-slate-900/95 backdrop-blur-xl',
          /* Mobile drawer: слайд + тень; десктоп: ширина */
          'max-lg:transition-[transform,box-shadow] max-lg:duration-500 max-lg:[transition-timing-function:cubic-bezier(0.32,0.72,0,1)]',
          'motion-reduce:max-lg:duration-200',
          /* Десктоп: мягкое раскрытие/сворачивание (синхронно с отступом main в app-shell) */
          'lg:transition-[width] lg:duration-500 lg:ease-[cubic-bezier(0.33,1,0.68,1)]',
          'motion-reduce:lg:duration-300',
          sidebarOpen
            ? 'translate-x-0 max-lg:shadow-[0_25px_80px_-12px_rgba(0,0,0,0.55),0_0_1px_rgba(255,255,255,0.06)_inset] max-lg:rounded-r-2xl'
            : '-translate-x-full max-lg:shadow-none',
          'lg:translate-x-0',
          sidebarCollapsed ? 'lg:w-[4.5rem]' : 'lg:w-56',
        )}
      >
        {/* Логотип + сворачивание (десктоп) + тема */}
        <div
          className={cn(
            'flex shrink-0 items-center border-b border-slate-800 px-4',
            sidebarCollapsed
              ? 'h-auto flex-col gap-3 py-4 lg:flex lg:items-center lg:py-4'
              : 'h-16 justify-between gap-2',
          )}
        >
          <Link
            href="/dashboard"
            onClick={() => setSidebarOpen(false)}
            className={cn(
              'min-w-0 shrink bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-lg font-bold tracking-tight text-transparent',
              'transition-opacity duration-200 hover:opacity-90',
              sidebarCollapsed && 'lg:hidden',
            )}
          >
            {tAuth('brandName')}
          </Link>

          <div
            className={cn(
              'flex items-center gap-2',
              sidebarCollapsed ? 'flex-col' : 'shrink-0',
            )}
          >
            <button
              type="button"
              onClick={() => toggleSidebarCollapsed()}
              className={cn(
                'hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg lg:flex',
                'border-0 bg-transparent text-slate-400',
                'transition-colors duration-300 ease-out',
                'hover:bg-slate-800/60 hover:text-primary',
                'active:scale-[0.96]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
              )}
              aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? t('expandSidebar') : t('collapseSidebar')}
            >
              <ChevronLeft
                className={cn(
                  'h-5 w-5 transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
                  sidebarCollapsed && 'rotate-180',
                )}
                aria-hidden
              />
            </button>

            <ThemeToggle
              className={cn(
                'h-9 w-9 shrink-0 rounded-xl bg-slate-800/40 text-slate-400 shadow-sm',
                'transition-all duration-300 ease-out',
                'hover:bg-slate-800/90 hover:text-primary hover:shadow-[0_0_24px_-8px_rgba(59,130,246,0.35)]',
                'active:scale-[0.96] [&_svg]:text-current',
              )}
            />
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-x-hidden overflow-y-auto p-3">
          <ul className="space-y-0.5">
            {navItems.map(({ href, icon: Icon, key, roles }) => {
              // Role-gated items: hide entirely if user doesn't have the role
              if (roles !== null && user && !(roles as readonly string[]).includes(user.role)) return null;

              const itemDisabled = navLimitedMode && !NAV_LIMITED_ALLOWED_KEYS.has(key);
              const isActive =
                href === '/settings/profile'
                  ? pathname.includes('/settings')
                  : href === '/dashboard/calls'
                    ? pathname.includes('/dashboard/calls')
                    : href === '/dashboard/tasks'
                      ? pathname.includes('/dashboard/tasks')
                      : href === '/dashboard/staff'
                          ? pathname.includes('/dashboard/staff')
                          : href === '/dashboard/operations'
                            ? pathname.includes('/dashboard/operations')
                            : href === '/dashboard'
                              ? pathname.includes('/dashboard') &&
                                !pathname.includes('/dashboard/tasks') &&
                                !pathname.includes('/dashboard/calls') &&
                                !pathname.includes('/dashboard/calendar') &&
                                !pathname.includes('/dashboard/operations') &&
                                !pathname.includes('/dashboard/staff') &&
                                !pathname.includes('/dashboard/unmapped') &&
                                !pathname.match(/\/dashboard\/incidents/)
                              : pathname.includes(href);

              const rowClassName = cn(
                'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-medium',
                'transition-all duration-300 ease-out',
                itemDisabled
                  ? 'cursor-not-allowed border-transparent text-slate-500 opacity-60'
                  : isActive
                    ? 'border-primary/25 bg-primary/15 text-primary shadow-[inset_0_0_0_1px_rgba(59,130,246,0.25)]'
                    : 'border-transparent text-slate-400 hover:border-primary/35 hover:bg-slate-800/90 hover:text-primary hover:shadow-sm hover:shadow-[0_0_24px_-8px_rgba(59,130,246,0.35)] active:scale-[0.99]',
                sidebarCollapsed && 'lg:justify-center lg:gap-0 lg:px-2',
                showCollapsedChrome && 'lg:relative',
              );

              const rowContent = (
                <>
                  <span className="relative inline-flex shrink-0">
                    <Icon className="h-4 w-4" />
                    {showCollapsedChrome && key === 'tasks' && openIncidents > 0 && (
                      <span
                        className="absolute -right-0.5 -top-0.5 size-[5px] rounded-full bg-amber-500 ring-1 ring-slate-900"
                        title={t('tasksIncidentsHint')}
                        aria-label={t('tasksIncidentsHint')}
                      />
                    )}
                    {showCollapsedChrome && key === 'chat' && chatNeedsHuman && (
                      <span
                        className="absolute -right-0.5 -top-0.5 size-[5px] rounded-full bg-amber-500 ring-1 ring-slate-900"
                        title={t('chatNeedsHumanHint')}
                        aria-label={t('chatNeedsHumanHint')}
                      />
                    )}
                    {showCollapsedChrome && key === 'calls' && callsBadge > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 size-[5px] rounded-full bg-teal-400 ring-1 ring-slate-900" />
                    )}
                  </span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 text-left transition-[opacity,transform] duration-300 ease-out',
                      sidebarCollapsed && 'lg:hidden',
                    )}
                  >
                    {t(key)}
                  </span>
                  {!showCollapsedChrome && key === 'tasks' && openIncidents > 0 && (
                    <span
                      className="inline-block size-[5px] shrink-0 rounded-full bg-amber-500 ring-1 ring-slate-900/80"
                      title={t('tasksIncidentsHint')}
                      aria-label={t('tasksIncidentsHint')}
                    />
                  )}
                  {!showCollapsedChrome && key === 'chat' && chatNeedsHuman && (
                    <span
                      className="inline-block size-[5px] shrink-0 rounded-full bg-amber-500 ring-1 ring-slate-900/80"
                      title={t('chatNeedsHumanHint')}
                      aria-label={t('chatNeedsHumanHint')}
                    />
                  )}
                  {!showCollapsedChrome && key === 'calls' && callsBadge > 0 && (
                    <span className="inline-flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded-full bg-teal-500/20 px-1 text-[10px] font-bold text-teal-300 ring-1 ring-teal-500/30">
                      {callsBadge > 99 ? '99+' : callsBadge}
                    </span>
                  )}
                </>
              );

              const linkInner = itemDisabled ? (
                <span aria-disabled="true" className={rowClassName}>
                  {rowContent}
                </span>
              ) : (
                <Link
                  href={href}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
                      setSidebarOpen(false);
                      return;
                    }
                    e.preventDefault();
                    setSidebarOpen(false);
                    router.push(href);
                  }}
                  className={rowClassName}
                >
                  {rowContent}
                </Link>
              );

              const linkEl =
                showCollapsedChrome ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{linkInner}</TooltipTrigger>
                    <TooltipContent side="right" sideOffset={10} className="font-medium">
                      {t(key)}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  linkInner
                );

              return (
                <li key={href}>
                  {linkEl}
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Sign out */}
        {user ? (
          <div className="shrink-0 border-t border-slate-800 p-3">
            {showCollapsedChrome ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(
                      'relative h-11 w-full justify-center rounded-xl border border-slate-700/60 bg-slate-800/40 px-2 text-slate-400 shadow-sm',
                      'transition-all duration-300 ease-out',
                      'hover:border-primary/35 hover:bg-slate-800/90 hover:text-primary hover:shadow-[0_0_24px_-8px_rgba(59,130,246,0.35)]',
                      'active:scale-[0.96]',
                    )}
                    onClick={() => void handleLogout()}
                  >
                    <LogOut className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="sr-only">{t('signOut')}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={10}>
                  {t('signOut')}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className={cn(
                  'h-11 w-full justify-start gap-3 rounded-xl border border-slate-700/60 bg-slate-800/40 px-3 text-slate-400 shadow-sm',
                  'transition-all duration-300 ease-out',
                  'hover:border-primary/35 hover:bg-slate-800/90 hover:text-primary hover:shadow-[0_0_24px_-8px_rgba(59,130,246,0.35)]',
                  'active:scale-[0.99]',
                )}
                onClick={() => void handleLogout()}
              >
                <LogOut className="h-4 w-4 shrink-0" aria-hidden />
                <span>{t('signOut')}</span>
              </Button>
            )}
          </div>
        ) : null}

        <div className="h-px bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
        <div className="h-1 bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent" />
      </aside>
    </TooltipProvider>
  );
}
