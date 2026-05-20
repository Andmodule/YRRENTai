'use client';

import { ArrowLeft, Settings2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { CompanyGlobalRulesForm } from '@/components/property/company-global-rules-form';
import { Button } from '@/components/ui/button';

export default function PropertyGlobalRulesPage() {
  const t = useTranslations('properties.globalRules');

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" className="shrink-0" asChild>
          <Link href="/properties" aria-label={t('back')}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </div>

      <CompanyGlobalRulesForm />
    </div>
  );
}
