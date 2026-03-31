'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Settings } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import { useAuth } from '@/hooks/use-auth';
import { SettingsNav } from '@/components/settings/settings-nav';
import {
  SETTINGS_OWNER_ONLY_SEGMENTS,
  normalizeRole,
} from '@/components/settings/settings-role';
import { filterNavItemsForRole, settingsNavItems } from '@/components/settings/settings-nav-config';
import { Skeleton } from '@/components/ui/skeleton';

export function SettingsSubLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('settings');
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? '';

  const role = normalizeRole(user?.role);

  useEffect(() => {
    if (isLoading || !user) return;
    if (role === 'staff') {
      router.replace('/dashboard');
    }
  }, [isLoading, user, role, router]);

  useEffect(() => {
    if (isLoading || !user || role !== 'manager') return;
    const segments = pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && SETTINGS_OWNER_ONLY_SEGMENTS.includes(last as (typeof SETTINGS_OWNER_ONLY_SEGMENTS)[number])) {
      router.replace('/settings/profile');
    }
  }, [isLoading, user, role, pathname, router]);

  const effectiveRole: 'owner' | 'manager' = role === 'manager' ? 'manager' : 'owner';
  const navItems = role === 'staff' ? [] : filterNavItemsForRole(effectiveRole, settingsNavItems);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="flex flex-col gap-6 md:flex-row md:gap-8">
          <div className="hidden w-[220px] shrink-0 space-y-2 md:block">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
          <Skeleton className="h-64 min-w-0 flex-1 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!user || role === 'staff') {
    return null;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-bold">{t('title')}</h1>
      </div>

      <div className="flex min-h-0 min-w-0 flex-col gap-6 md:flex-row md:items-start md:gap-8">
        <SettingsNav items={navItems} />
        <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
