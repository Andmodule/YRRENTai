'use client';

import { Package } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/** Заметный блок на экране «Задачи», чтобы менеджер увидел новую сводку снабжения. */
export function ManagerSupplyAttentionBanner({
  count,
  onOpenSupply,
}: {
  count: number;
  onOpenSupply: () => void;
}) {
  const t = useTranslations('tasks.managerSupply');
  if (count <= 0) return null;

  return (
    <div
      className="mx-3 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-gradient-to-r from-primary/10 via-primary/5 to-muted/40 px-3 py-2.5 shadow-sm dark:border-primary/25 dark:from-primary/10 dark:via-card/50 dark:to-card/80 sm:mx-4"
      role="status"
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Package className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{t('supplyBannerTitle')}</p>
          <p className="text-xs text-muted-foreground">
            {t('supplyBannerHint', { count })}
          </p>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        className="shrink-0 font-semibold"
        onClick={onOpenSupply}
      >
        {t('supplyBannerCta')}
      </Button>
    </div>
  );
}
