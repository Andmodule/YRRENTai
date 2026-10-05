'use client';

import { useTranslations } from 'next-intl';
import { FlaskConical, Lock, TestTube2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { PricingTabs } from '@/modules/pricing/components/PricingTabs';
import { usePricingAccess } from '@/modules/pricing/hooks';

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('pricing');
  const access = usePricingAccess();

  if (access.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full max-w-md" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!access.canManage || !access.enabled) {
    return (
      <EmptyState
        icon={<Lock className="h-8 w-8" />}
        title={t(access.canManage ? 'disabledTitle' : 'forbiddenTitle')}
        description={t(access.canManage ? 'disabledText' : 'forbiddenText')}
      />
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <PricingTabs />
      {access.dryRun ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t('modes.dryRun')}</span>
        </div>
      ) : access.pilot ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-sky-300/60 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
          <TestTube2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t('modes.pilot')}</span>
        </div>
      ) : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
