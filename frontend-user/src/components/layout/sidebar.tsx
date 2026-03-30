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
  MessageSquare,
  Settings,
  Sparkles,
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, key: 'dashboard' },
  { href: '/properties', icon: Building2, key: 'properties' },
  { href: '/bookings', icon: CalendarDays, key: 'bookings' },
  { href: '/chat', icon: MessageSquare, key: 'chat' },
  { href: '/kb-improvement', icon: Sparkles, key: 'kbImprovement' },
  { href: '/settings', icon: Settings, key: 'settings' },
] as const;

export function Sidebar() {
  const t = useTranslations('nav');
  const { sidebarOpen, setSidebarOpen } = useUiStore();
  const pathname = usePathname();

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 z-40 flex h-screen w-56 flex-col border-r border-[#dbeafe] bg-background transition-transform duration-200 dark:border-r-indigo-900/45',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0',
        )}
      >
        <div className="flex h-16 shrink-0 items-center border-b border-[#dbeafe] px-6 dark:border-b-indigo-900/45">
          <span className="text-lg font-bold tracking-tight">RentAI</span>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          <ul className="space-y-1">
            {navItems.map(({ href, icon: Icon, key }) => {
              const isActive =
                href === '/dashboard'
                  ? pathname.includes('/dashboard')
                  : pathname.includes(href);

              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={() => setSidebarOpen(false)}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
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
      </aside>
    </>
  );
}
