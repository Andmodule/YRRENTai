'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useUiStore } from '@/stores/ui.store';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Building2,
  Inbox,
  LayoutGrid,
  ListTodo,
  MessageSquare,
  Settings,
  Sparkles,
  Users,
  Warehouse,
} from 'lucide-react';
import { useOpenIncidentsCount } from '@/modules/incidents/hooks/useIncidents';
import { useUnmappedReportsCount } from '@/hooks/use-unmapped-reports';

const navItems = [
  { href: '/dashboard',      icon: LayoutDashboard, key: 'dashboard' },
  { href: '/properties',     icon: Building2,        key: 'properties' },
  { href: '/dashboard/tasks', icon: ListTodo,        key: 'tasks' },
  { href: '/dashboard/unmapped', icon: Inbox,        key: 'unmappedInbox' },
  { href: '/dashboard/staff', icon: Users,           key: 'staff' },
  { href: '/dashboard/operations', icon: Warehouse,  key: 'operations' },
  { href: '/dashboard/calendar', icon: LayoutGrid, key: 'calendar' },
  { href: '/chat',           icon: MessageSquare,    key: 'chat' },
  { href: '/kb-improvement', icon: Sparkles,         key: 'kbImprovement' },
  { href: '/settings/profile', icon: Settings,       key: 'settings' },
] as const;

export function Sidebar() {
  const t = useTranslations('nav');
  const router = useRouter();
  const { sidebarOpen, setSidebarOpen } = useUiStore();
  const pathname = usePathname();
  const { data: openIncidents = 0 } = useOpenIncidentsCount();
  const { data: unmappedCount = 0 } = useUnmappedReportsCount();

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          aria-hidden
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 z-50 flex h-screen w-56 flex-col',
          'border-r border-slate-800 bg-slate-900/95 backdrop-blur-sm',
          'transition-transform duration-200',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0',
        )}
      >
        {/* Logo */}
        <div className="flex h-16 shrink-0 items-center border-b border-slate-800 px-6">
          <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-lg font-bold tracking-tight text-transparent">
            RentAI
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-3">
          <ul className="space-y-0.5">
            {navItems.map(({ href, icon: Icon, key }) => {
              const isActive =
                href === '/settings/profile'
                  ? pathname.includes('/settings')
                  : href === '/dashboard/tasks'
                    ? pathname.includes('/dashboard/tasks')
                    : href === '/dashboard/unmapped'
                      ? pathname.includes('/dashboard/unmapped')
                      : href === '/dashboard/staff'
                        ? pathname.includes('/dashboard/staff')
                        : href === '/dashboard/operations'
                          ? pathname.includes('/dashboard/operations')
                          : href === '/dashboard'
                            ? pathname.includes('/dashboard') &&
                              !pathname.includes('/dashboard/tasks') &&
                              !pathname.includes('/dashboard/calendar') &&
                              !pathname.includes('/dashboard/operations') &&
                              !pathname.includes('/dashboard/staff') &&
                              !pathname.includes('/dashboard/unmapped') &&
                              !pathname.match(/\/dashboard\/incidents/)
                            : pathname.includes(href);

              return (
                <li key={href}>
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
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary/15 text-primary border border-primary/20'
                        : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-transparent',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 text-left">{t(key)}</span>
                    {key === 'tasks' && openIncidents > 0 && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full bg-amber-500"
                        title={t('tasksIncidentsHint')}
                        aria-label={t('tasksIncidentsHint')}
                      />
                    )}
                    {key === 'unmappedInbox' && unmappedCount > 0 && (
                      <span
                        className="min-w-[1.25rem] shrink-0 rounded-full bg-amber-500/90 px-1.5 py-0 text-center text-[10px] font-semibold leading-none text-slate-950 tabular-nums"
                        title={t('unmappedInboxBadgeHint')}
                        aria-label={t('unmappedInboxBadgeHint')}
                      >
                        {unmappedCount > 99 ? '99+' : unmappedCount}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Bottom gradient line */}
        <div className="h-px bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
        <div className="h-1 bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent" />
      </aside>
    </>
  );
}
