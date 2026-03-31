'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { ClipboardList, Package, Languages, BarChart3, LayoutGrid } from 'lucide-react';

const LINKS = [
  { href: '/dashboard/operations', segment: '', icon: LayoutGrid },
  { href: '/dashboard/operations/inventory', segment: 'inventory', icon: Package },
  { href: '/dashboard/operations/listings', segment: 'listings', icon: Languages },
  { href: '/dashboard/operations/reports', segment: 'reports', icon: BarChart3 },
] as const;

export default function OperationsLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('operations.nav');
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-400">{t('subtitle')}</p>
        </div>
        <Link
          href="/dashboard/tasks"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary"
        >
          <ClipboardList className="h-4 w-4" />
          {t('tasksLink')}
        </Link>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-slate-800 pb-2">
        {LINKS.map(({ href, segment, icon: Icon }) => {
          const active =
            segment === ''
              ? !pathname.includes('/operations/inventory') &&
                !pathname.includes('/operations/listings') &&
                !pathname.includes('/operations/reports')
              : pathname.includes(`/dashboard/operations/${segment}`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/15 text-primary border border-primary/20'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-transparent',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {t(segment || 'overview')}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
