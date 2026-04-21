'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';

export default function AutomationsOverviewPage() {
  const t = useTranslations('automations');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('overview.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{t('overview.subtitle')}</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm text-muted-foreground">{t('overview.hint')}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild variant="default">
            <Link href="/automations/operations">{t('overview.ctaOperations')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/automations/intent-test">{t('overview.ctaIntentTest')}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
