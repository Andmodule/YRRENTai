'use client';

import { memo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Task } from '../../types';
import { TaskCard } from './TaskCard';
import type { KanbanColumnDef } from '../../constants';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Incident } from '@/modules/incidents/hooks/useIncidents';
import { IncidentKanbanCard } from '@/modules/incidents/components/IncidentKanbanCard';

export const KanbanColumn = memo(function KanbanColumn({
  column,
  tasks,
  incidents,
  onOpenTask,
  onOpenIncident,
}: {
  column: KanbanColumnDef;
  tasks: Task[];
  incidents: Incident[];
  onOpenTask: (t: Task) => void;
  onOpenIncident: (i: Incident) => void;
}) {
  const t = useTranslations('tasks.columns');
  const tKanban = useTranslations('tasks.kanban');
  const tEmpty = useTranslations('tasks.emptyColumn');
  const { setNodeRef, isOver } = useDroppable({ id: column.status });

  const totalCount = tasks.length + incidents.length;
  const hasContent = totalCount > 0;

  const ariaCountLabel = t('columnAria', { title: t(column.headerKey), count: totalCount });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[min(52dvh,380px)] w-full min-w-0 flex-col rounded-xl border border-border bg-muted/50 p-2 dark:bg-muted/30 md:min-h-[min(70vh,560px)]',
        isOver && 'ring-2 ring-primary/40',
      )}
      aria-label={ariaCountLabel}
    >
      <div className={cn('mb-2 flex items-center justify-between gap-1 px-1 text-sm font-semibold', column.headerClass)}>
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span className="truncate">{t(column.headerKey)}</span>
          {column.status === 'issue' && (
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
        {!hasContent ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            {tEmpty(column.emptyKey)}
          </div>
        ) : (
          <>
            {incidents.map((inc) => (
              <IncidentKanbanCard key={inc.uuid} incident={inc} onOpen={onOpenIncident} />
            ))}
            {tasks.map((task) => (
              <TaskCard key={task.uuid} task={task} onOpen={onOpenTask} />
            ))}
          </>
        )}
      </div>
    </div>
  );
});
