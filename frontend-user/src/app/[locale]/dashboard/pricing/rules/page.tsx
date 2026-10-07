'use client';

import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { RulesScreen } from '@/modules/pricing/components/RulesScreen';
import { usePricingAccess } from '@/modules/pricing/hooks';

export default function PricingRulesPage() {
  const t = useTranslations('pricing.rules');
  const { autoRules } = usePricingAccess();
  if (!autoRules) {
    return <EmptyState icon={<Lock className="h-8 w-8" />} title={t('disabledTitle')} description={t('disabledText')} />;
  }
  return <RulesScreen />;
}
