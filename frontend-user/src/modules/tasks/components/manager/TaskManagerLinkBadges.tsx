'use client';

import { memo, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Package } from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { Task } from '../../types';
import { TASK_MANAGER_PANEL_QUERY, TASK_MANAGER_SUPPLY_EVENT_QUERY } from '../../task-url-params';

export const TaskManagerLinkBadges = memo(function TaskManagerLinkBadges({
  task,
  className,
  compact,
}: {
  task: Task;
  className?: string;
  /** Smaller chips for dense list rows */
  compact?: boolean;
}) {
  const t = useTranslations('tasks.kanban');
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const supplyHref = useMemo(() => {
    const ids = task.pendingSupplyInterpretationIds;
    if (!ids?.length) return null;
    const p = new URLSearchParams(searchParams.toString());
    p.set(TASK_MANAGER_PANEL_QUERY, 'supply');
    p.set(TASK_MANAGER_SUPPLY_EVENT_QUERY, ids[0]!);
    return `${pathname}?${p.toString()}`;
  }, [pathname, searchParams, task.pendingSupplyInterpretationIds]);

  const incidentHref = useMemo(() => {
    const ids = task.linkedIncidentIdsFromTask;
    if (!ids?.length) return null;
    return `/dashboard/incidents?incident=${encodeURIComponent(ids[0]!)}`;
  }, [task.linkedIncidentIdsFromTask]);

  if (!supplyHref && !incidentHref) return null;

  const chip = compact ? 'text-[9px] px-1 py-px' : 'text-[10px] px-1.5 py-0.5';
  const nSupply = task.pendingSupplyInterpretationIds?.length ?? 0;
  const nInc = task.linkedIncidentIdsFromTask?.length ?? 0;

  return (
    <div
      className={cn('flex flex-wrap items-center gap-1', className)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {supplyHref ? (
        <Link
          href={supplyHref}
          className={cn(
            'inline-flex max-w-[12rem] items-center gap-0.5 truncate rounded-md border border-[#008CA4]/40 bg-[#008CA4]/10 font-medium text-[#006a7a] dark:border-[#00d4ff]/35 dark:bg-[#00d4ff]/10 dark:text-[#7ee8ff]',
            chip,
          )}
        >
          <Package className="h-2.5 w-2.5 shrink-0" aria-hidden />
          <span className="truncate">{t('taskBadgeShortage')}</span>
          {nSupply > 1 ? <span className="shrink-0 tabular-nums opacity-80">+{nSupply - 1}</span> : null}
        </Link>
      ) : null}
      {incidentHref ? (
        <Link
          href={incidentHref}
          className={cn(
            'inline-flex max-w-[12rem] items-center gap-0.5 truncate rounded-md border border-amber-500/40 bg-amber-500/10 font-medium text-amber-950 dark:text-amber-100',
            chip,
          )}
        >
          <AlertTriangle className="h-2.5 w-2.5 shrink-0" aria-hidden />
          <span className="truncate">{t('taskBadgeIncidentFromTask')}</span>
          {nInc > 1 ? <span className="shrink-0 tabular-nums opacity-80">+{nInc - 1}</span> : null}
        </Link>
      ) : null}
    </div>
  );
});
