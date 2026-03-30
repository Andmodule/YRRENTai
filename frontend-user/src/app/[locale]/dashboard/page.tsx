'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useProperties } from '@/hooks/use-properties';
import { Building2, CalendarDays, MessageSquare, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const { properties, isLoading } = useProperties();

  const stats = [
    {
      label: t('stats.properties'),
      value: isLoading ? null : properties.length,
      icon: Building2,
      href: '/properties',
      color: 'text-blue-600 bg-blue-50',
    },
    {
      label: t('stats.bookings'),
      value: '—',
      icon: CalendarDays,
      href: '/bookings',
      color: 'text-green-600 bg-green-50',
    },
    {
      label: t('stats.chats'),
      value: '—',
      icon: MessageSquare,
      href: '/chat',
      color: 'text-purple-600 bg-purple-50',
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map(({ label, value, icon: Icon, href, color }) => (
          <Link
            key={href}
            href={href}
            className="group flex items-center gap-4 rounded-lg border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${color}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted-foreground">{label}</p>
              {value === null ? (
                <Skeleton className="mt-1 h-6 w-8" />
              ) : (
                <p className="text-2xl font-semibold">{value}</p>
              )}
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
        ))}
      </div>

      {!isLoading && properties.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Building2 className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h3 className="mt-4 font-semibold">{t('noProperties')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('noPropertiesDescription')}</p>
          <Button asChild className="mt-4">
            <Link href="/properties">{t('addFirstProperty')}</Link>
          </Button>
        </div>
      )}

      {!isLoading && properties.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">{t('recentProperties')}</h2>
            <Link href="/properties" className="text-sm text-primary hover:underline">
              {t('viewAll')}
            </Link>
          </div>
          <div className="divide-y rounded-lg border bg-card">
            {properties.slice(0, 3).map((p) => (
              <Link
                key={p.id}
                href={`/properties/${p.id}`}
                className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-accent"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Building2 className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-sm">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{p.address}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{p.currency}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
