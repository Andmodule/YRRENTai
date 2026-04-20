'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { fetchOverviewStats } from '@/lib/api/calls-stats';
import {
  LayoutDashboard,
  Radio,
  History,
  ClipboardCheck,
  Settings2,
  MoreHorizontal,
} from 'lucide-react';
import { useState } from 'react';

interface NavItem {
  href: string;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
  badge?: number | null;
  alert?: boolean;
}

interface CallsNavProps {
  variant?: 'sidebar' | 'tabs';
  className?: string;
}

function useBadges() {
  const { data } = useQuery({
    queryKey: ['calls-nav-badges'],
    queryFn: () => fetchOverviewStats(),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const hasEmergency =
    (data?.recentEscalations?.length ?? 0) > 0 ||
    (data?.recentFailedTransfers?.length ?? 0) > 0;

  return {
    liveBadge: data?.activeSessions ?? 0,
    qaBadge: data?.pendingReviewsCount ?? 0,
    overviewAlert: hasEmergency,
  };
}

export function CallsNav({ variant = 'sidebar', className }: CallsNavProps) {
  const pathname = usePathname();
  const { liveBadge, qaBadge, overviewAlert } = useBadges();
  const [moreOpen, setMoreOpen] = useState(false);

  const items: NavItem[] = [
    {
      href: '/calls/overview',
      label: 'Обзор',
      shortLabel: 'Обзор',
      icon: <LayoutDashboard className="h-4 w-4 shrink-0" />,
      alert: overviewAlert,
    },
    {
      href: '/calls/live',
      label: 'Live',
      shortLabel: 'Live',
      icon: <Radio className="h-4 w-4 shrink-0" />,
      badge: liveBadge > 0 ? liveBadge : null,
    },
    {
      href: '/calls/history',
      label: 'История',
      shortLabel: 'История',
      icon: <History className="h-4 w-4 shrink-0" />,
    },
    {
      href: '/calls/qa',
      label: 'QA',
      shortLabel: 'QA',
      icon: <ClipboardCheck className="h-4 w-4 shrink-0" />,
      badge: qaBadge > 0 ? qaBadge : null,
    },
    {
      href: '/calls/settings',
      label: 'Настройки',
      shortLabel: '⚙',
      icon: <Settings2 className="h-4 w-4 shrink-0" />,
    },
  ];

  const isActive = (item: NavItem) => pathname.startsWith(item.href);

  // Tabs: first 4 always visible, 5th behind More on very small screens
  if (variant === 'tabs') {
    const primary = items.slice(0, 4);
    const secondary = items.slice(4);

    return (
      <nav className={cn('flex overflow-x-auto border-b border-slate-200 bg-white', className)}>
        {primary.map((item) => (
          <TabItem key={item.href} item={item} active={isActive(item)} />
        ))}

        {secondary.length > 0 && (
          <div className="relative ml-auto shrink-0">
            <button
              onClick={() => setMoreOpen((v) => !v)}
              className={cn(
                'flex items-center gap-1 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors h-full',
                secondary.some(isActive)
                  ? 'border-teal-500 text-teal-700'
                  : 'border-transparent text-slate-400 hover:text-slate-600',
              )}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {moreOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                {secondary.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50',
                      isActive(item) ? 'text-teal-700 font-medium' : 'text-slate-600',
                    )}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </nav>
    );
  }

  // Sidebar variant
  return (
    <nav className={cn('flex flex-col gap-0.5 p-2', className)}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            'flex items-center justify-between rounded-xl px-3 py-2 text-sm font-medium transition-colors',
            isActive(item)
              ? 'bg-teal-50 text-teal-700'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800',
          )}
        >
          <span className="flex items-center gap-2.5">
            {item.icon}
            {item.label}
            {item.alert && (
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            )}
          </span>
          {item.badge !== null && item.badge !== undefined && (
            <span className="rounded-full bg-teal-500 text-white text-[10px] font-bold leading-none px-1.5 py-0.5 min-w-[1.1rem] text-center">
              {item.badge > 99 ? '99+' : item.badge}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

function TabItem({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={cn(
        'relative flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-colors shrink-0',
        active
          ? 'border-teal-500 text-teal-700'
          : 'border-transparent text-slate-500 hover:text-slate-700',
      )}
    >
      {item.icon}
      <span className="hidden sm:inline">{item.label}</span>
      <span className="sm:hidden">{item.shortLabel}</span>

      {item.alert && (
        <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-red-500" />
      )}
      {item.badge !== null && item.badge !== undefined && (
        <span className="rounded-full bg-teal-500 text-white text-[10px] font-bold leading-none px-1.5 py-0.5 min-w-[1.1rem] text-center">
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      )}
    </Link>
  );
}
