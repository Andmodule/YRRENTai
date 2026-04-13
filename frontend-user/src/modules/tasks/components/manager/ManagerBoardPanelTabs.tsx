'use client';

import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { TASK_MANAGER_PANEL_QUERY } from '../../task-url-params';

export type ManagerBoardPanel = 'tasks' | 'supply';

export function ManagerBoardPanelTabs({
  panel,
  supplyBadgeCount = 0,
  endContent,
}: {
  panel: ManagerBoardPanel;
  /** Показать число на вкладке «Снабжение» (сводка/очередь). */
  supplyBadgeCount?: number;
  /** Панель действий справа (вкладка «Снабжение»): справочник, портал, «Добавить довоз». */
  endContent?: ReactNode;
}) {
  const t = useTranslations('tasks.managerSupply');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setPanel = useCallback(
    (next: ManagerBoardPanel) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'supply') {
        params.set(TASK_MANAGER_PANEL_QUERY, 'supply');
      } else {
        params.delete(TASK_MANAGER_PANEL_QUERY);
      }
      const q = params.toString();
      router.replace(q ? `${pathname}?${q}` : pathname);
    },
    [pathname, router, searchParams],
  );

  const chipBase =
    'inline-flex shrink-0 items-center justify-center rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150';
  const chipActive =
    'border-[#D1EBF1] bg-[#E0F2F5] text-[#008CA4] shadow-sm font-semibold dark:border-[#00d4ff]/40 dark:bg-[#00d4ff]/14 dark:text-[#a5f3fc] dark:font-semibold';
  const chipIdle =
    'border-slate-200 bg-white text-slate-600 shadow-sm hover:border-slate-300 hover:bg-slate-50 dark:border-slate-600/55 dark:bg-slate-900/55 dark:text-slate-300 dark:hover:bg-slate-800/90';

  const tabs = (
    <div className="flex min-w-0 shrink-0 items-center gap-1.5" role="tablist" aria-label={t('tabsAria')}>
      <button
        type="button"
        role="tab"
        aria-selected={panel === 'tasks'}
        className={cn(chipBase, panel === 'tasks' ? chipActive : chipIdle)}
        onClick={() => setPanel('tasks')}
      >
        {t('tabTasks')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={panel === 'supply'}
        className={cn(chipBase, 'relative gap-1.5', panel === 'supply' ? chipActive : chipIdle)}
        onClick={() => setPanel('supply')}
      >
        {t('tabSupply')}
        {supplyBadgeCount > 0 ? (
          <span
            className="min-w-[1.125rem] rounded-full bg-[#008CA4] px-1 py-0.5 text-center text-[10px] font-bold leading-none text-white dark:bg-[#00b8d4]"
            aria-hidden
          >
            {supplyBadgeCount > 99 ? '99+' : supplyBadgeCount}
          </span>
        ) : null}
      </button>
    </div>
  );

  if (endContent) {
    return (
      <div className="flex shrink-0 flex-col gap-2 border-b border-border/50 px-4 pb-2 pt-2 sm:px-4 md:flex-row md:items-center md:justify-between md:gap-x-3 md:gap-y-0 lg:pt-2">
        <div className="min-w-0 shrink-0">{tabs}</div>
        <div className="flex w-full min-w-0 flex-col md:w-auto md:flex-1 md:flex-row md:justify-end">
          {endContent}
        </div>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5 px-4 pb-1 pt-2 sm:px-4 lg:pt-1.5">{tabs}</div>
  );
}
