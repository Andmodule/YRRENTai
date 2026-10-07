'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Percent, ShieldCheck, Workflow } from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { usePricingAccess, usePricingProperties } from '../hooks';

const LINKS = [
  { href: '/dashboard/pricing', segment: '', icon: Percent, key: 'promotions' as const },
  { href: '/dashboard/pricing/rules', segment: 'rules', icon: Workflow, key: 'rules' as const },
  { href: '/dashboard/pricing/min-prices', segment: 'min-prices', icon: ShieldCheck, key: 'minPrices' as const },
];

/** Same look as the «Операции» section tabs. */
export function PricingTabs() {
  const t = useTranslations('pricing.tabs');
  const pathname = usePathname();
  const { data: rows } = usePricingProperties(true);
  const { autoRules } = usePricingAccess();
  const links = LINKS.filter((l) => l.key !== 'rules' || autoRules);

  /** Booking objects without access to promotions (or a failed check) or without a minimum price. */
  const attention = useMemo(
    () =>
      (rows ?? []).filter(
        (r) =>
          r.bookingConnected &&
          (r.promotionsAccess === 'denied' ||
            (r.promotionsAccess !== 'ok' && !!r.promotionsAccessCode) ||
            r.minPrice == null),
      ).length,
    [rows],
  );

  return (
    <nav
      className={cn(
        'sticky top-0 z-20 -mx-4 border-b border-slate-800/90 bg-background/90 px-4 pb-2 pt-0.5 backdrop-blur-md',
        'supports-[backdrop-filter]:bg-background/75 dark:border-slate-800 dark:bg-slate-950/85',
        'sm:mx-0 sm:rounded-xl sm:border sm:bg-card/50 sm:px-2 sm:py-1.5 sm:backdrop-blur-none dark:sm:bg-card/30',
      )}
      aria-label={t('label')}
    >
      <div className="flex snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain pb-0.5 [-webkit-overflow-scrolling:touch]">
        {links.map(({ href, segment, icon: Icon, key }) => {
          const active =
            segment === ''
              ? !pathname.includes('/pricing/min-prices') && !pathname.includes('/pricing/rules')
              : pathname.includes(`/pricing/${segment}`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex shrink-0 snap-start items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                'min-h-[44px] min-w-0 sm:min-h-0 sm:py-2',
                active
                  ? 'border border-primary/25 bg-primary/15 text-primary shadow-sm'
                  : 'border border-transparent text-slate-400 hover:bg-slate-800/80 hover:text-slate-200',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="whitespace-nowrap">{t(key)}</span>
              {key === 'minPrices' && attention > 0 ? (
                <span
                  title={t('attention', { count: attention })}
                  className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
                >
                  {attention}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
