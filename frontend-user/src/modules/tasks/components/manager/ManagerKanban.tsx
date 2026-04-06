'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useTranslations } from 'next-intl';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTasks, useUpdateTaskStatus } from '../../hooks/useTasks';
import { useTaskFilters } from '../../hooks/useTaskFilters';
import { useTasksViewMode } from '../../hooks/useTasksViewMode';
import type { Task, TaskFilters, TaskStatus } from '../../types';
import { KANBAN_COLUMNS } from '../../constants';
import { TaskCard } from './TaskCard';
import { TaskListView } from './TaskListView';
import { TaskTableView } from './TaskTableView';
import { TaskDetailDrawer } from '../shared/TaskDetailDrawer';
import { useIncidents } from '@/modules/incidents/hooks/useIncidents';
import type { Incident } from '@/modules/incidents/hooks/useIncidents';
import { IncidentDetailDrawer } from '@/modules/incidents/components/IncidentDetailDrawer';
import { IncidentKanbanCard } from '@/modules/incidents/components/IncidentKanbanCard';
import { TooltipProvider } from '@/components/ui/tooltip';
import { KanbanBoardRail } from './KanbanBoardRail';
import { TasksFiltersBar } from './TasksFiltersBar';
import { usePendingTaskDelete } from '../../hooks/usePendingTaskDelete';
import { usePendingTaskMarkDone } from '../../hooks/usePendingTaskMarkDone';
import { usePendingIncidentClose } from '@/modules/incidents/hooks/usePendingIncidentClose';

export function ManagerKanban({
  filters,
  onFiltersChange,
}: {
  filters: TaskFilters;
  onFiltersChange: (f: TaskFilters | ((prev: TaskFilters) => TaskFilters)) => void;
}) {
  const t = useTranslations('tasks');
  const tTma = useTranslations('tma');
  const { enqueueDeleteAfterSwipe } = usePendingTaskDelete({
    taskDeletedMessage: tTma('taskDeletedToast'),
    undoLabel: tTma('undoDelete'),
    deleteErrorMessage: tTma('taskDeleteError'),
  });
  const { enqueueMarkDoneAfterSwipe } = usePendingTaskMarkDone({
    taskMarkedMessage: tTma('taskMarkedDoneToast'),
    undoLabel: tTma('undoDelete'),
    markDoneErrorMessage: tTma('taskMarkDoneError'),
  });
  const { enqueueCloseAfterSwipe } = usePendingIncidentClose({
    incidentClosedMessage: tTma('incidentClosedToast'),
    undoLabel: tTma('undoDelete'),
    closeErrorMessage: tTma('incidentCloseError'),
  });
  const { view } = useTasksViewMode();
  const { data, isLoading, isError, refetch } = useTasks(filters);
  const { data: incidentsRaw, isLoading: incidentsLoading } = useIncidents();
  const filtered = useTaskFilters(data?.tasks ?? [], filters);
  const { mutate: updateStatus } = useUpdateTaskStatus();

  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [detailIncident, setDetailIncident] = useState<Incident | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const boardIncidents = useMemo(() => {
    if (!incidentsRaw?.length) return [];
    const start = new Date(filters.dateRange.start);
    start.setHours(0, 0, 0, 0);
    const end = new Date(filters.dateRange.end);
    end.setHours(23, 59, 59, 999);
    const q = filters.propertyQuery.trim().toLowerCase();
    return incidentsRaw.filter((i) => {
      if (i.status !== 'open' && i.status !== 'in_review') return false;
      if (filters.dateRangeEnabled) {
        const t0 = new Date(i.createdAt).getTime();
        if (t0 < start.getTime() || t0 > end.getTime()) return false;
      }
      if (q && !i.propertyTitle.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [incidentsRaw, filters.dateRange, filters.dateRangeEnabled, filters.propertyQuery]);

  const tableTasks = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const da = a.dueDate ? new Date(a.dueDate).getTime() : 0;
      const db = b.dueDate ? new Date(b.dueDate).getTime() : 0;
      if (da !== db) return da - db;
      return (a.title || a.propertyTitle).localeCompare(b.title || b.propertyTitle);
    });
  }, [filtered]);

  useEffect(() => {
    if (!detailIncident || !incidentsRaw) return;
    const next = incidentsRaw.find((x) => x.uuid === detailIncident.uuid);
    if (next) setDetailIncident(next);
  }, [incidentsRaw, detailIncident?.uuid]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 280, tolerance: 12 } }),
  );

  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = {
      pending: [],
      in_progress: [],
      done: [],
      issue: [],
    };
    for (const task of filtered) {
      map[task.status].push(task);
    }
    return map;
  }, [filtered]);

  const findTask = (id: string) => filtered.find((x) => x.uuid === id);

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    setActiveTask(findTask(id) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const task = findTask(activeId);
    if (!task) return;

    const overId = String(over.id);
    let newStatus: TaskStatus | null = null;

    if (KANBAN_COLUMNS.some((c) => c.status === overId)) {
      newStatus = overId as TaskStatus;
    } else {
      const overTask = findTask(overId);
      if (overTask) newStatus = overTask.status;
    }

    if (newStatus && newStatus !== task.status) {
      updateStatus({ uuid: activeId, status: newStatus });
    }
  };

  const openTask = (task: Task) => {
    setDetailIncident(null);
    setDetailTask(task);
  };

  const openIncident = (incident: Incident) => {
    setDetailTask(null);
    setDetailIncident(incident);
  };

  const patchStatus = useCallback(
    (uuid: string, status: TaskStatus) => {
      const task =
        filtered.find((x) => x.uuid === uuid) ?? data?.tasks?.find((x) => x.uuid === uuid);
      if (!task) return;
      if (task.status === status) return;
      updateStatus({ uuid, status });
    },
    [filtered, data?.tasks, updateStatus],
  );

  const isEmptyBoard = filtered.length === 0 && boardIncidents.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden md:gap-3">
      <div className="flex shrink-0 items-center max-md:-mx-2">
        <TasksFiltersBar filters={filters} onFiltersChange={onFiltersChange} />
      </div>

      {isError && (
        <Alert variant="destructive" className="shrink-0">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {t('loadError')}
            <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {(isLoading || incidentsLoading) && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <Skeleton className="h-10 w-full max-w-md shrink-0 rounded-lg" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full shrink-0 rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && !isError && view === 'list' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {isEmptyBoard ? (
            <p className="shrink-0 rounded-lg border border-dashed border-border/40 bg-muted/15 px-2 py-6 text-center text-sm text-muted-foreground md:rounded-xl md:px-4 md:py-10">
              {t('viewModes.listEmpty')}
            </p>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]">
              <TaskListView
                tasks={filtered}
                boardIncidents={boardIncidents}
                onOpenTask={openTask}
                onOpenIncident={openIncident}
                onStatusChange={patchStatus}
                onSwipeDeleteTask={enqueueDeleteAfterSwipe}
                onSwipeMarkDone={enqueueMarkDoneAfterSwipe}
                onSwipeCloseIncident={enqueueCloseAfterSwipe}
              />
            </div>
          )}
        </div>
      )}

      {!isLoading && !isError && view === 'table' && (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {filtered.length === 0 && boardIncidents.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/40 bg-muted/15 px-2 py-6 text-center text-sm text-muted-foreground md:rounded-xl md:px-4 md:py-10">
              {t('viewModes.listEmpty')}
            </p>
          ) : (
            filtered.length > 0 && (
              <TaskTableView tasks={tableTasks} onOpenTask={openTask} onStatusChange={patchStatus} />
            )
          )}
          {boardIncidents.length > 0 && (
            <section aria-labelledby="tasks-table-incidents">
              <h2 id="tasks-table-incidents" className="mb-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
                {t('viewModes.tableIncidentsHeading')}
              </h2>
              <ul className="flex flex-col gap-2" role="list">
                {boardIncidents.map((i) => (
                  <li key={i.uuid}>
                    <IncidentKanbanCard incident={i} onOpen={openIncident} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {!isLoading && !isError && view === 'kanban' && (
        <div className="min-h-0 flex-1 overflow-auto">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <TooltipProvider delayDuration={200}>
              <KanbanBoardRail
                byStatus={byStatus}
                boardIncidents={boardIncidents}
                onOpenTask={openTask}
                onOpenIncident={openIncident}
              />
            </TooltipProvider>
            <DragOverlay dropAnimation={null}>
              {activeTask ? (
                <div className="w-[260px] opacity-95">
                  <TaskCard task={activeTask} onOpen={() => {}} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}

      <TaskDetailDrawer task={detailTask} open={!!detailTask} onOpenChange={(o) => !o && setDetailTask(null)} />
      <IncidentDetailDrawer
        incident={detailIncident}
        open={!!detailIncident}
        onOpenChange={(o) => !o && setDetailIncident(null)}
      />
    </div>
  );
}
