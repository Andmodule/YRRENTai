import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { ChecklistTemplatesScreen } from '@/components/checklist/ChecklistTemplatesScreen';

export default async function ChecklistTemplatesPage() {
  const t = await getTranslations('checklist.templates');

  return (
    <div className="min-h-0 flex-1">
      <div className="border-b border-border px-4 py-4 md:px-6">
        <h1 className="text-2xl font-semibold">{t('pageTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pageSubtitle')}</p>
      </div>
      <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">{t('loading')}</div>}>
        <ChecklistTemplatesScreen />
      </Suspense>
    </div>
  );
}
