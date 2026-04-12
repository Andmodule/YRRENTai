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
      className="mx-3 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-[#008CA4]/35 bg-gradient-to-r from-[#E0F2F5]/95 to-[#f0fdfa]/90 px-3 py-2.5 shadow-sm dark:border-[#00d4ff]/30 dark:from-[#0c1f24]/90 dark:to-[#0d2520]/80 sm:mx-4"
      role="status"
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#008CA4]/15 text-[#008CA4] dark:bg-[#00d4ff]/12 dark:text-[#7dd3fc]">
          <Package className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('supplyBannerTitle')}</p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {t('supplyBannerHint', { count })}
          </p>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        className="shrink-0 bg-[#008CA4] font-semibold text-white hover:bg-[#007a90] dark:bg-[#00a8c4] dark:hover:bg-[#0090a8]"
        onClick={onOpenSupply}
      >
        {t('supplyBannerCta')}
      </Button>
    </div>
  );
}
