'use client';

import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { TASK_MANAGER_PANEL_QUERY } from '../../task-url-params';
import { tasksChipActiveClasses, tasksChipIdleClasses } from '../../tasks-chip-classes';

export type ManagerBoardPanel = 'tasks' | 'supply' | 'staffMessages';

const PANEL_SUPPLY = 'supply';
const PANEL_STAFF_MESSAGES = 'staff-messages';

export function ManagerBoardPanelTabs({
  panel,
  supplyBadgeCount = 0,
  staffMessagesBadgeCount = 0,
  endContent,
}: {
  panel: ManagerBoardPanel;
  /** Показать число на вкладке «Снабжение» (сводка/очередь). */
  supplyBadgeCount?: number;
  /** Непрочитанные заметки персонала (сумма по задачам). */
  staffMessagesBadgeCount?: number;
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
        params.set(TASK_MANAGER_PANEL_QUERY, PANEL_SUPPLY);
      } else if (next === 'staffMessages') {
        params.set(TASK_MANAGER_PANEL_QUERY, PANEL_STAFF_MESSAGES);
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
  const chipActive = tasksChipActiveClasses;
  const chipIdle = tasksChipIdleClasses;

  const tabs = (
    <div
      className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5"
      role="tablist"
      aria-label={t('tabsAria')}
    >
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
            className="min-w-[1.125rem] rounded-full bg-primary px-1 py-0.5 text-center text-[10px] font-bold leading-none text-primary-foreground"
            aria-hidden
          >
            {supplyBadgeCount > 99 ? '99+' : supplyBadgeCount}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={panel === 'staffMessages'}
        className={cn(
          chipBase,
          'relative gap-1.5',
          panel === 'staffMessages' ? chipActive : chipIdle,
        )}
        onClick={() => setPanel('staffMessages')}
      >
        {t('tabStaffMessages')}
        {staffMessagesBadgeCount > 0 ? (
          <span
            className="min-w-[1.125rem] rounded-full bg-primary px-1 py-0.5 text-center text-[10px] font-bold leading-none text-primary-foreground"
            aria-hidden
          >
            {staffMessagesBadgeCount > 99 ? '99+' : staffMessagesBadgeCount}
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
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-4 pb-1 pt-2 sm:px-4 lg:pt-1.5">
      {tabs}
    </div>
  );
}

export function parseManagerBoardPanel(raw: string | null): ManagerBoardPanel {
  if (raw === PANEL_SUPPLY) return 'supply';
  if (raw === PANEL_STAFF_MESSAGES) return 'staffMessages';
  return 'tasks';
}
