'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SettingsSectionCard } from '@/components/settings/settings-section-card';
import { SettingsPageHeader } from '@/components/settings/settings-page-header';

export function BillingSettingsPage() {
  const t = useTranslations('settings.billing');
  const tc = useTranslations('settings.common');

  return (
    <div className="space-y-4">
      <SettingsPageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} dev />

      <SettingsSectionCard title={t('currentPlan')}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="default" className="text-sm">
              {t('planFree')}
            </Badge>
            <div className="text-sm text-muted-foreground">
              <div>
                {t('nextCharge')}: {t('nextChargePlaceholder')}
              </div>
              <div>
                {t('propertiesUsage')}: {t('propertiesUsageValue', { used: 0, limit: 5 })}
              </div>
            </div>
          </div>
          <Button type="button" onClick={() => toast.info(tc('soon'))}>
            {t('upgradeCta')}
          </Button>
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title={t('paymentsCard')}>
        <p className="text-sm text-muted-foreground">{t('paymentsStub')}</p>
      </SettingsSectionCard>
    </div>
  );
}
