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
    <div className="space-y-4 sm:space-y-6">
      {/* Мобайл: горизонтальный скролл табов + липкая подложка под шапкой приложения */}
      <nav
        className={cn(
          'sticky top-0 z-20 -mx-4 border-b border-slate-800/90 bg-background/90 px-4 pb-2 pt-0.5 backdrop-blur-md',
          'supports-[backdrop-filter]:bg-background/75 dark:border-slate-800 dark:bg-slate-950/85',
          'sm:mx-0 sm:rounded-xl sm:border sm:bg-card/50 sm:px-2 sm:py-1.5 sm:backdrop-blur-none dark:sm:bg-card/30',
        )}
        aria-label={t('title')}
      >
        <div
          className="flex snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain pb-0.5 [-webkit-overflow-scrolling:touch]"
          role="tablist"
        >
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
                role="tab"
                aria-selected={active}
                className={cn(
                  'inline-flex shrink-0 snap-start items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  'min-h-[44px] min-w-0 sm:min-h-0 sm:py-2',
                  active
                    ? 'border border-primary/25 bg-primary/15 text-primary shadow-sm'
                    : 'border border-transparent text-slate-400 hover:bg-slate-800/80 hover:text-slate-200',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="whitespace-nowrap">{t(segment || 'overview')}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="flex justify-end px-0.5">
        <Link
          href="/dashboard/tasks"
          className="inline-flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-primary sm:text-sm"
        >
          <ClipboardList className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t('tasksLink')}
        </Link>
      </div>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
