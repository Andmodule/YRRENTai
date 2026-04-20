'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useProperties } from '@/hooks/use-properties';
import { useAuth } from '@/hooks/use-auth';
import { useUnmappedReportsCount } from '@/hooks/use-unmapped-reports';
import { Building2, Inbox, LayoutGrid, MessageSquare, ArrowRight, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AiHoursSavedWidget } from '@/components/dashboard/ai-hours-saved-widget';
import { ReplyAnalyticsSection } from '@/components/dashboard/reply-analytics-section';

const STAT_ICONS = [
  {
    key: 'properties' as const,
    icon: Building2,
    href: '/properties',
    accent:
      'border border-cyan-600/25 bg-cyan-500/10 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/15 dark:text-cyan-400',
  },
  {
    key: 'calendar' as const,
    icon: LayoutGrid,
    href: '/dashboard/calendar',
    accent:
      'border border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-400',
  },
  {
    key: 'chats' as const,
    icon: MessageSquare,
    href: '/chat',
    accent:
      'border border-violet-600/25 bg-violet-500/10 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-400',
  },
];

function DashboardUnmappedBanner() {
  const { user } = useAuth();
  const { data: count = 0 } = useUnmappedReportsCount();
  const t = useTranslations('dashboard');
  if (!user || (user.role !== 'OWNER' && user.role !== 'MANAGER')) return null;
  if (!count) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/35 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/50 dark:text-amber-100">
      <Inbox className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <p className="min-w-0 flex-1">
        {t('unmappedBanner')} <span className="font-semibold tabular-nums">({count})</span>
      </p>
      <Button
        asChild
        variant="secondary"
        size="sm"
        className="shrink-0 border-amber-600/25 bg-amber-100 text-amber-950 hover:bg-amber-200/90 dark:border-amber-500/30 dark:bg-amber-900/50 dark:text-amber-50 dark:hover:bg-amber-900/70"
      >
        <Link href="/dashboard/unmapped">{t('unmappedBannerCta')}</Link>
      </Button>
    </div>
  );
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const { properties, isLoading } = useProperties();

  const statValues: Record<string, string | number | null> = {
    properties: isLoading ? null : properties.length,
    calendar: '—',
    chats: '—',
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 text-foreground sm:space-y-6">

      <DashboardUnmappedBanner />

      {/* Stat cards — 3 compact columns on mobile */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {STAT_ICONS.map(({ key, icon: Icon, href, accent }) => {
          const label = t(`stats.${key}`);
          const value = statValues[key];

          return (
            <Link
              key={href}
              href={href}
              className="group flex flex-col items-center gap-1.5 rounded-lg border border-border bg-card p-2.5 transition-colors duration-200 ease-in-out hover:border-border hover:bg-accent/60 dark:border-slate-700 dark:bg-slate-800/70 dark:hover:border-slate-600 dark:hover:bg-slate-800 sm:flex-row sm:items-center sm:gap-4 sm:rounded-xl sm:p-5"
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md sm:h-11 sm:w-11 sm:rounded-lg ${accent}`}
              >
                <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col items-center text-center sm:items-start sm:text-left">
                <p className="line-clamp-2 text-[9px] uppercase leading-tight tracking-wide text-muted-foreground sm:line-clamp-none sm:text-xs">
                  {label}
                </p>
                {value === null ? (
                  <Skeleton className="mt-0.5 h-5 w-7 bg-muted sm:mt-1 sm:h-7 sm:w-10 dark:bg-slate-700" />
                ) : (
                  <p className="text-lg font-bold tabular-nums text-foreground sm:text-2xl">{value}</p>
                )}
              </div>
              <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-200 ease-in-out group-hover:opacity-100 sm:block" />
            </Link>
          );
        })}
      </div>

      <AiHoursSavedWidget />

      {/* Analytics section */}
      <ReplyAnalyticsSection />

      {/* Empty state */}
      {!isLoading && properties.length === 0 && (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center dark:border-slate-700 sm:p-10">
          <Building2 className="mx-auto h-8 w-8 text-muted-foreground sm:h-10 sm:w-10" />
          <h3 className="mt-3 text-sm font-semibold text-foreground sm:mt-4 sm:text-base dark:text-slate-200">
            {t('noProperties')}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{t('noPropertiesDescription')}</p>
          <Button
            asChild
            className="mt-4 bg-gradient-to-r from-cyan-600 to-violet-600 hover:from-cyan-500 hover:to-violet-500 text-white font-semibold border-0 sm:mt-5"
          >
            <Link href="/properties">{t('addFirstProperty')}</Link>
          </Button>
        </div>
      )}

      {/* Recent properties */}
      {!isLoading && properties.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t('recentProperties')}
            </h2>
            <Link
              href="/properties"
              className="flex items-center gap-1 text-xs text-primary transition-colors hover:text-primary/80 dark:text-cyan-400 dark:hover:text-cyan-300"
            >
              {t('viewAll')}
              <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card dark:divide-slate-700/80 dark:border-slate-700 dark:bg-slate-800/70">
            {properties.slice(0, 3).map((p) => (
              <Link
                key={p.id}
                href={`/properties/${p.id}`}
                className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/80 dark:hover:bg-slate-700/50 sm:gap-4 sm:px-4 sm:py-3"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-600/20 bg-cyan-500/10 text-cyan-700 dark:border-cyan-500/20 dark:bg-cyan-500/15 dark:text-cyan-400 sm:h-9 sm:w-9">
                  <Building2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-foreground dark:text-slate-200">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground dark:text-slate-500">{p.address}</p>
                </div>
                <span className="shrink-0 text-xs font-medium text-muted-foreground dark:text-slate-500">
                  {p.currency}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
