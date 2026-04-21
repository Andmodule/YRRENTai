'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/automations', key: 'overview' as const },
  { href: '/automations/operations', key: 'operations' as const },
  { href: '/automations/intent-test', key: 'intentTest' as const },
  { href: '/automations/guests', key: 'guests' as const },
  { href: '/automations/smart-home', key: 'smartHome' as const },
  { href: '/automations/revenue', key: 'revenue' as const },
  { href: '/automations/support', key: 'support' as const },
] as const;

function isAutomationsOverviewPath(pathname: string): boolean {
  return /\/automations\/?$/.test(pathname);
}

function isLinkActive(pathname: string, href: string): boolean {
  if (href === '/automations') {
    return isAutomationsOverviewPath(pathname);
  }
  return pathname.includes(href);
}

function NavLinks({
  onNavigate,
  className,
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  const t = useTranslations('automations');
  const pathname = usePathname();

  return (
    <ul className={cn('space-y-0.5', className)}>
      {LINKS.map(({ href, key }) => {
        const active = isLinkActive(pathname, href);
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={() => onNavigate?.()}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                'min-h-[44px] sm:min-h-0',
                active
                  ? 'border-primary/25 bg-primary/15 text-primary shadow-sm'
                  : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground dark:hover:bg-slate-800/80',
              )}
            >
              {t(`nav.${key}`)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AutomationsSubNav() {
  const t = useTranslations('automations');
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between gap-3 lg:hidden">
        <p className="text-sm font-medium text-foreground">{t('nav.sectionTitle')}</p>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0 border-slate-200 dark:border-slate-800"
          aria-label={t('nav.openMenu')}
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent title={t('nav.mobileTitle')} description={t('nav.mobileDescription')} className="max-h-[85dvh]">
          <NavLinks onNavigate={() => setMobileOpen(false)} />
        </DialogContent>
      </Dialog>

      <aside
        className={cn(
          'hidden w-64 shrink-0 lg:flex lg:flex-col',
          'rounded-xl border border-slate-200 bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/80',
        )}
        aria-label={t('nav.sectionTitle')}
      >
        <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('nav.sectionTitle')}
        </p>
        <NavLinks />
      </aside>
    </>
  );
}
