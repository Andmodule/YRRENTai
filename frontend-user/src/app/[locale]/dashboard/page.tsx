'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useProperties } from '@/hooks/use-properties';
import { Building2, CalendarDays, MessageSquare, ArrowRight, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ReplyAnalyticsSection } from '@/components/dashboard/reply-analytics-section';

const STAT_ICONS = [
  {
    key: 'properties' as const,
    icon: Building2,
    href: '/properties',
    accent: 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-400',
  },
  {
    key: 'bookings' as const,
    icon: CalendarDays,
    href: '/bookings',
    accent: 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400',
  },
  {
    key: 'chats' as const,
    icon: MessageSquare,
    href: '/chat',
    accent: 'bg-violet-500/15 border border-violet-500/30 text-violet-400',
  },
];

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const { properties, isLoading } = useProperties();

  const statValues: Record<string, string | number | null> = {
    properties: isLoading ? null : properties.length,
    bookings: '—',
    chats: '—',
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 text-white">

      {/* Page header */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">
          RentAI
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-white">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('subtitle')}</p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {STAT_ICONS.map(({ key, icon: Icon, href, accent }) => {
          const label = t(`stats.${key}`);
          const value = statValues[key];

          return (
            <Link
              key={href}
              href={href}
              className="group flex items-center gap-4 rounded-xl border border-slate-700 bg-slate-800/70 p-5 transition-all hover:border-slate-600 hover:bg-slate-800"
            >
              <div className={`flex h-11 w-11 items-center justify-center rounded-lg shrink-0 ${accent}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
                {value === null ? (
                  <Skeleton className="mt-1 h-7 w-10 bg-slate-700" />
                ) : (
                  <p className="text-2xl font-bold text-white">{value}</p>
                )}
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-600 opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
          );
        })}
      </div>

      {/* Analytics section */}
      <ReplyAnalyticsSection />

      {/* Empty state */}
      {!isLoading && properties.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center">
          <Building2 className="mx-auto h-10 w-10 text-slate-600" />
          <h3 className="mt-4 font-semibold text-slate-200">{t('noProperties')}</h3>
          <p className="mt-1 text-sm text-slate-400">{t('noPropertiesDescription')}</p>
          <Button
            asChild
            className="mt-5 bg-gradient-to-r from-cyan-600 to-violet-600 hover:from-cyan-500 hover:to-violet-500 text-white font-semibold border-0"
          >
            <Link href="/properties">{t('addFirstProperty')}</Link>
          </Button>
        </div>
      )}

      {/* Recent properties */}
      {!isLoading && properties.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
              {t('recentProperties')}
            </h2>
            <Link
              href="/properties"
              className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              {t('viewAll')}
              <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/70 overflow-hidden divide-y divide-slate-700/80">
            {properties.slice(0, 3).map((p) => (
              <Link
                key={p.id}
                href={`/properties/${p.id}`}
                className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-slate-700/50"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/15 border border-cyan-500/20 text-cyan-400">
                  <Building2 className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-slate-200">{p.name}</p>
                  <p className="truncate text-xs text-slate-500">{p.address}</p>
                </div>
                <span className="shrink-0 text-xs text-slate-500 font-medium">{p.currency}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
