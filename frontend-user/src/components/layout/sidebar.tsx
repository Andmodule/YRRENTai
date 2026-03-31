'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { useUiStore } from '@/stores/ui.store';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Building2,
  CalendarDays,
  LayoutGrid,
  ListTodo,
  MessageSquare,
  Settings,
  Sparkles,
} from 'lucide-react';

const navItems = [
  { href: '/dashboard',      icon: LayoutDashboard, key: 'dashboard' },
  { href: '/properties',     icon: Building2,        key: 'properties' },
  { href: '/dashboard/tasks', icon: ListTodo,        key: 'tasks' },
  { href: '/dashboard/calendar', icon: LayoutGrid, key: 'calendar' },
  { href: '/bookings',       icon: CalendarDays,     key: 'bookings' },
  { href: '/chat',           icon: MessageSquare,    key: 'chat' },
  { href: '/kb-improvement', icon: Sparkles,         key: 'kbImprovement' },
  { href: '/settings',       icon: Settings,         key: 'settings' },
] as const;

export function Sidebar() {
  const t = useTranslations('nav');
  const { sidebarOpen, setSidebarOpen } = useUiStore();
  const pathname = usePathname();

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 z-40 flex h-screen w-56 flex-col',
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
                href === '/dashboard/tasks'
                  ? pathname.includes('/dashboard/tasks')
                  : href === '/dashboard'
                    ? pathname.includes('/dashboard') && !pathname.includes('/dashboard/')
                    : pathname.includes(href);

              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={() => setSidebarOpen(false)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary/15 text-primary border border-primary/20'
                        : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-transparent',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{t(key)}</span>
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
