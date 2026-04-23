'use client';

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  TASK_MANAGER_PANEL_QUERY,
  TASK_STAFF_MSG_ASSIGNEE_QUERY,
  TASK_STAFF_MSG_ASSIGNEE_UNASSIGNED,
  TASK_STAFF_MSG_UNREAD_QUERY,
} from '../../task-url-params';
import { tasksChipActiveClasses, tasksChipIdleClasses } from '../../tasks-chip-classes';
import { useManagerStaffNotesFeed } from '../../hooks/useManagerStaffNotesFeed';
import type { TaskNoteFeedItem } from '../../types';
import { parseManagerBoardPanel } from './ManagerBoardPanelTabs';

export function StaffMessagesFilterPanel({ className }: { className?: string }) {
  const t = useTranslations('tasks.managerSupply');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const staffPanel = parseManagerBoardPanel(searchParams.get(TASK_MANAGER_PANEL_QUERY));
  const { data: items = [] } = useManagerStaffNotesFeed(staffPanel === 'staffMessages');

  const unreadOnly = searchParams.get(TASK_STAFF_MSG_UNREAD_QUERY) === '1';
  const assigneeRaw = searchParams.get(TASK_STAFF_MSG_ASSIGNEE_QUERY)?.trim() ?? '';

  const assigneeOptions = useMemo(() => {
    const map = new Map<string, string>();
    let hasUnassigned = false;
    for (const row of items as TaskNoteFeedItem[]) {
      if (row.assigneeId == null || row.assigneeId === '') {
        hasUnassigned = true;
        continue;
      }
      const name = row.assigneeName?.trim() || '—';
      if (!map.has(row.assigneeId)) map.set(row.assigneeId, name);
    }
    const list = [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    if (hasUnassigned) {
      list.unshift({ id: TASK_STAFF_MSG_ASSIGNEE_UNASSIGNED, name: t('staffMsgFilterUnassigned') });
    }
    return list;
  }, [items, t]);

  const setParams = useCallback(
    (patch: { unread?: boolean | null; assigneeId?: string | null }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (patch.unread === true) {
        params.set(TASK_STAFF_MSG_UNREAD_QUERY, '1');
      } else if (patch.unread === false || patch.unread === null) {
        params.delete(TASK_STAFF_MSG_UNREAD_QUERY);
      }
      if (patch.assigneeId === null || patch.assigneeId === '' || patch.assigneeId === 'all') {
        params.delete(TASK_STAFF_MSG_ASSIGNEE_QUERY);
      } else if (patch.assigneeId !== undefined) {
        params.set(TASK_STAFF_MSG_ASSIGNEE_QUERY, patch.assigneeId);
      }
      const q = params.toString();
      router.replace(q ? `${pathname}?${q}` : pathname);
    },
    [pathname, router, searchParams],
  );

  const chipBase =
    'inline-flex shrink-0 items-center justify-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-colors duration-150';

  const reset = () => {
    setParams({ unread: null, assigneeId: 'all' });
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('staffMsgFilterReadState')}
        </p>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('staffMsgFilterReadState')}>
          <button
            type="button"
            onClick={() => setParams({ unread: false })}
            className={cn(chipBase, !unreadOnly ? tasksChipActiveClasses : tasksChipIdleClasses)}
          >
            {t('staffMsgFilterAllMessages')}
          </button>
          <button
            type="button"
            onClick={() => setParams({ unread: true })}
            className={cn(chipBase, unreadOnly ? tasksChipActiveClasses : tasksChipIdleClasses)}
          >
            {t('staffMsgFilterUnreadOnly')}
          </button>
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('staffMsgFilterAssigneeSection')}
        </p>
        <select
          value={assigneeRaw || 'all'}
          onChange={(e) => {
            const v = e.target.value;
            setParams({ assigneeId: v === 'all' ? 'all' : v });
          }}
          className="h-9 w-full rounded-lg border border-border/60 bg-muted/20 px-2 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t('staffMsgFilterAssigneeSection')}
        >
          <option value="all">{t('staffMsgFilterAssigneeAll')}</option>
          {assigneeOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="button" variant="outline" size="sm" className="w-full rounded-lg" onClick={reset}>
        {t('staffMsgFilterReset')}
      </Button>
    </div>
  );
}
