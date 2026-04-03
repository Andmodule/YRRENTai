'use client';

import { memo, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { Task, TaskStatus } from '../../types';
import { KANBAN_COLUMNS } from '../../constants';
import { TaskListRow } from './TaskListRow';
import { IncidentKanbanCard } from '@/modules/incidents/components/IncidentKanbanCard';
import type { Incident } from '@/modules/incidents/hooks/useIncidents';

export const TaskListView = memo(function TaskListView({
  byStatus,
  boardIncidents,
  onOpenTask,
  onOpenIncident,
  onStatusChange,
}: {
  byStatus: Record<TaskStatus, Task[]>;
  boardIncidents: Incident[];
  onOpenTask: (t: Task) => void;
  onOpenIncident: (i: Incident) => void;
  onStatusChange: (uuid: string, status: TaskStatus) => void;
}) {
  const tCol = useTranslations('tasks.columns');

  const sections = useMemo(() => {
    return KANBAN_COLUMNS.map((col) => ({
      ...col,
      tasks: byStatus[col.status],
      incidents: col.status === 'issue' ? boardIncidents : undefined,
    }));
  }, [byStatus, boardIncidents]);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {sections.map((section) => {
        const inc = section.incidents ?? [];
        const taskCount = section.tasks.length;
        const total = section.status === 'issue' ? taskCount + inc.length : taskCount;
        if (total === 0) return null;

        return (
          <section key={section.status} aria-labelledby={`task-section-${section.status}`}>
            <h2
              id={`task-section-${section.status}`}
              className={cn(
                'mb-2 flex items-center gap-2 border-b border-border pb-2 text-sm font-semibold',
                section.headerClass,
              )}
            >
              <span>{tCol(section.headerKey)}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {total}
              </span>
            </h2>
            <ul className="flex flex-col gap-2" role="list">
              {section.tasks.map((task) => (
                <li key={task.uuid}>
                  <TaskListRow task={task} onOpen={onOpenTask} onStatusChange={onStatusChange} />
                </li>
              ))}
              {section.status === 'issue' &&
                inc.map((incident) => (
                  <li key={`inc-${incident.uuid}`}>
                    <IncidentKanbanCard incident={incident} onOpen={onOpenIncident} />
                  </li>
                ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
});
