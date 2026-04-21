'use client';

import { useTranslations } from 'next-intl';
import { AutomationRoadmapGrid } from '@/components/automations/AutomationRoadmapGrid';
import { GUEST_ROADMAP_TEMPLATES } from '@/lib/automations/domain-roadmap-catalogs';

export default function AutomationsGuestsPage() {
  const t = useTranslations('automations');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('placeholders.guestsTitle')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('placeholders.guestsBody')}</p>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('roadmap.sectionHint')}</p>
      </div>
      <AutomationRoadmapGrid items={GUEST_ROADMAP_TEMPLATES} />
    </div>
  );
}
