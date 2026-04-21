'use client';

import { useTranslations } from 'next-intl';
import { AutomationRoadmapGrid } from '@/components/automations/AutomationRoadmapGrid';
import { REVENUE_ROADMAP_TEMPLATES } from '@/lib/automations/domain-roadmap-catalogs';

export default function AutomationsRevenuePage() {
  const t = useTranslations('automations');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('placeholders.revenueTitle')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('placeholders.revenueBody')}</p>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('roadmap.sectionHint')}</p>
      </div>
      <AutomationRoadmapGrid items={REVENUE_ROADMAP_TEMPLATES} />
    </div>
  );
}
