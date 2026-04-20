'use client';

import { useAuth } from '@/hooks/use-auth';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { redirect } from 'next/navigation';
import {
  LayoutDashboard, Radio, History, ClipboardCheck,
  Settings2, Layers, ScrollText, ChevronRight, Rocket,
} from 'lucide-react';
import { useCallsNavBadge, useAlerts } from '@/hooks/use-calls-admin';
import { useState } from 'react';

const PRIMARY_NAV = [
  { href: '/dashboard/calls/overview',  label: 'Обзор',     short: '~',   icon: LayoutDashboard },
  { href: '/dashboard/calls/live',      label: 'Live',      short: 'L',   icon: Radio },
  { href: '/dashboard/calls/history',   label: 'История',   short: 'H',   icon: History },
  { href: '/dashboard/calls/qa',        label: 'QA',        short: 'QA',  icon: ClipboardCheck },
] as const;

const SECONDARY_NAV = [
  { href: '/dashboard/calls/rollout',  label: 'Rollout',    short: 'R', icon: Layers },
  { href: '/dashboard/calls/audit',    label: 'Аудит',      short: 'A', icon: ScrollText },
  { href: '/dashboard/calls/go-live',  label: 'Go-live',    short: '🚀', icon: Rocket },
  { href: '/dashboard/calls/settings', label: 'Настройки',  short: '⚙', icon: Settings2 },
] as const;

export default function CallsLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const badge = useCallsNavBadge(true);
  const { data: activeAlerts = [] } = useAlerts({ status: 'active' });
  const [showMore, setShowMore] = useState(false);

  if (!isLoading && user && user.role !== 'OWNER' && user.role !== 'MANAGER') {
    redirect('/dashboard');
  }

  const criticalCount = activeAlerts.filter((a) => a.severity === 'critical').length;
  const hasAlert = criticalCount > 0;

  const allNav = [...PRIMARY_NAV, ...SECONDARY_NAV];

  return (
    <div className="flex flex-col h-full min-h-0 -mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
      {/* Alert bar — only when critical alerts exist */}
      {hasAlert && (
        <div className="flex items-center gap-2 px-4 py-2 shrink-0 border-b border-destructive/30 bg-destructive/10 text-xs text-destructive dark:bg-red-950/60 dark:border-red-700/40 dark:text-red-300">
          <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse dark:bg-red-400" />
          <span>{criticalCount} критичный алерт{criticalCount > 1 ? 'а' : ''} — немедленное внимание</span>
          <Link
            href="/dashboard/calls/overview"
            className="ml-auto flex items-center gap-0.5 font-medium text-destructive hover:text-destructive/80 dark:text-red-400 dark:hover:text-red-200"
          >
            Перейти <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      )}

      {/* Sub-nav */}
      <div className="flex shrink-0 items-center gap-0 overflow-x-auto border-b border-border bg-muted/50 px-2 sm:px-4 dark:border-slate-700/60 dark:bg-slate-900/80">
        <span className="mr-2 hidden shrink-0 py-2.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground md:block">
          Звонки
        </span>

        {/* Primary tabs — always visible */}
        {PRIMARY_NAV.map(({ href, label, icon: Icon }) => {
          const isActive = pathname.includes(href.replace('/dashboard', ''));
          const isLive = href.includes('/live');
          const isQa = href.includes('/qa');
          const isOverview = href.includes('/overview');
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-3 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary text-primary dark:border-cyan-400 dark:text-cyan-300'
                  : 'border-transparent text-muted-foreground hover:text-foreground dark:text-slate-400 dark:hover:text-slate-200',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">{label}</span>

              {/* Overview: critical alert dot */}
              {isOverview && hasAlert && (
                <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
              )}
              {/* Live: active session pulse */}
              {isLive && badge > 0 && (
                <span className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-pulse shrink-0" />
              )}
              {/* QA: pending count */}
              {isQa && badge > 0 && (
                <span className="min-w-[1.2rem] shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-center text-[10px] font-bold text-primary ring-1 ring-primary/25 dark:bg-teal-500/20 dark:text-teal-300 dark:ring-teal-500/30">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </Link>
          );
        })}

        {/* Separator */}
        <div className="mx-1 hidden h-4 w-px shrink-0 bg-border dark:bg-slate-700/60 sm:block" />

        {/* Secondary tabs — hidden on very small screens, shown via More */}
        <div className="hidden sm:flex items-center">
          {SECONDARY_NAV.map(({ href, label, icon: Icon }) => {
            const isActive = pathname.includes(href.replace('/dashboard', ''));
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-primary text-primary dark:border-cyan-400 dark:text-cyan-300'
                    : 'border-transparent text-muted-foreground hover:text-foreground dark:text-slate-400 dark:hover:text-slate-200',
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden md:inline">{label}</span>
              </Link>
            );
          })}
        </div>

        {/* Mobile "More" trigger */}
        <div className="sm:hidden relative ml-auto">
          <button
            onClick={() => setShowMore((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-3 text-sm text-muted-foreground hover:text-foreground dark:text-slate-400 dark:hover:text-slate-200"
          >
            <ChevronRight className={cn('h-4 w-4 transition-transform', showMore && 'rotate-90')} />
          </button>
          {showMore && (
            <div className="absolute right-0 top-full z-50 min-w-[140px] rounded-lg border border-border bg-popover py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
              {SECONDARY_NAV.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setShowMore(false)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-popover-foreground hover:bg-muted dark:text-slate-300 dark:hover:bg-slate-700/50"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 text-foreground sm:p-5">
        {children}
      </div>
    </div>
  );
}
