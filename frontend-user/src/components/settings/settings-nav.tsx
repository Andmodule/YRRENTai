'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { SettingsNavItem } from '@/components/settings/settings-nav-config';

interface SettingsNavProps {
  items: SettingsNavItem[];
}

export function SettingsNav({ items }: SettingsNavProps) {
  const pathname = usePathname() ?? '';
  const t = useTranslations('settings');

  const linkClass = (href: string, isActive: boolean) =>
    cn(
      'flex min-w-0 items-center gap-2 rounded-lg py-2.5 pl-3 pr-2 text-sm font-medium transition-colors',
      'border-y border-r border-transparent',
      isActive
        ? 'border-primary/20 bg-primary/15 text-primary border-l-2 border-l-primary'
        : 'border-l-2 border-l-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200',
    );

  return (
    <>
      <nav className="hidden w-[220px] shrink-0 md:block" aria-label={t('subNavAria')}>
        <ul className="space-y-0.5">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = pathname.includes(item.href);
            return (
              <li key={item.id}>
                <Link href={item.href} className={linkClass(item.href, isActive)}>
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t(item.messageKey)}</span>
                  {item.dev ? (
                    <Badge variant="outline" className="font-mono uppercase text-[10px] text-amber-500">
                      dev
                    </Badge>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <nav
        className="-mx-1 flex gap-1 overflow-x-auto overflow-y-hidden pb-2 md:hidden"
        aria-label={t('subNavAria')}
      >
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.includes(item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap',
                isActive
                  ? 'bg-primary/15 text-primary ring-1 ring-primary/25'
                  : 'border border-transparent bg-muted/30 text-slate-400',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {t(item.messageKey)}
              {item.dev ? (
                <Badge variant="outline" className="font-mono uppercase text-[10px] text-amber-500">
                  dev
                </Badge>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
