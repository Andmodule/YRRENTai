'use client';

import { memo, useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Task } from '../../types';
import { TaskCard } from './TaskCard';
import type { KanbanColumnDef } from '../../constants';
import { IncidentKanbanCard } from '@/modules/incidents/components/IncidentKanbanCard';
import type { Incident } from '@/modules/incidents/hooks/useIncidents';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type IssueRow =
  | { kind: 'task'; task: Task }
  | { kind: 'incident'; incident: Incident };

export const KanbanColumn = memo(function KanbanColumn({
  column,
  tasks,
  onOpenTask,
  incidents,
  onOpenIncident,
  incidentColumnHint,
}: {
  column: KanbanColumnDef;
  tasks: Task[];
  onOpenTask: (t: Task) => void;
  incidents?: Incident[];
  onOpenIncident?: (i: Incident) => void;
  /** Подсказка: карточки инцидентов не перетаскиваются */
  incidentColumnHint?: boolean;
}) {
  const t = useTranslations('tasks.columns');
  const tKanban = useTranslations('tasks.kanban');
  const tEmpty = useTranslations('tasks.emptyColumn');
  const { setNodeRef, isOver } = useDroppable({ id: column.status });

  const rowsToRender = useMemo((): IssueRow[] => {
    if (column.status !== 'issue') {
      return tasks.map((task) => ({ kind: 'task' as const, task }));
    }
    const rows: IssueRow[] = [
      ...tasks.map((task) => ({ kind: 'task' as const, task })),
      ...(incidents ?? []).map((incident) => ({ kind: 'incident' as const, incident })),
    ];
    rows.sort((a, b) => {
      const ta = a.kind === 'task' ? new Date(a.task.createdAt).getTime() : new Date(a.incident.createdAt).getTime();
      const tb = b.kind === 'task' ? new Date(b.task.createdAt).getTime() : new Date(b.incident.createdAt).getTime();
      return tb - ta;
    });
    return rows;
  }, [column.status, tasks, incidents]);

  const totalCount =
    column.status === 'issue' ? tasks.length + (incidents?.length ?? 0) : tasks.length;

  const ariaCountLabel =
    column.status === 'issue' && incidents && incidents.length > 0
      ? t('columnAriaMixed', {
          title: t(column.headerKey),
          taskCount: tasks.length,
          incidentCount: incidents.length,
        })
      : t('columnAria', { title: t(column.headerKey), count: totalCount });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[min(52dvh,380px)] w-full flex-col rounded-xl border border-border bg-muted/50 p-2 dark:bg-muted/30 md:min-h-[min(70vh,560px)] md:w-[min(100%,280px)] md:shrink-0',
        isOver && 'ring-2 ring-primary/40',
      )}
      aria-label={ariaCountLabel}
    >
      <div className={cn('mb-2 flex items-center justify-between gap-1 px-1 text-sm font-semibold', column.headerClass)}>
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span className="truncate">{t(column.headerKey)}</span>
          {incidentColumnHint && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={tKanban('incidentNoDragAria')}
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[240px]">
                {tKanban('incidentNoDragHint')}
              </TooltipContent>
            </Tooltip>
          )}
        </span>
        <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground dark:bg-card">
          {totalCount}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {totalCount === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            {tEmpty(column.emptyKey)}
          </div>
        ) : (
          rowsToRender.map((row) =>
            row.kind === 'task' ? (
              <TaskCard key={row.task.uuid} task={row.task} onOpen={onOpenTask} />
            ) : (
              <IncidentKanbanCard
                key={`inc-${row.incident.uuid}`}
                incident={row.incident}
                onOpen={onOpenIncident ?? (() => {})}
              />
            ),
          )
        )}
      </div>
    </div>
  );
});
