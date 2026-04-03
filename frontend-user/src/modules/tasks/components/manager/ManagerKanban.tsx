'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { AlertCircle, ChevronDown, Kanban, LayoutList, Table2, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useTasks, useUpdateTaskStatus } from '../../hooks/useTasks';
import { useTaskFilters } from '../../hooks/useTaskFilters';
import { useTasksViewMode } from '../../hooks/useTasksViewMode';
import type { Task, TaskFilters, TaskPriority, TaskStatus } from '../../types';
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
import { useMatchMedia } from '@/hooks/use-match-media';
import { cn } from '@/lib/utils';
import { KanbanBoardRail } from './KanbanBoardRail';

export function ManagerKanban({
  filters,
  onFiltersChange,
}: {
  filters: TaskFilters;
  onFiltersChange: (f: TaskFilters | ((prev: TaskFilters) => TaskFilters)) => void;
}) {
  const t = useTranslations('tasks');
  const { view, setView } = useTasksViewMode();
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
      const t0 = new Date(i.createdAt).getTime();
      if (t0 < start.getTime() || t0 > end.getTime()) return false;
      if (q && !i.propertyTitle.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [incidentsRaw, filters.dateRange, filters.propertyQuery]);

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

  const patchStatus = (uuid: string, status: TaskStatus) => {
    const task = findTask(uuid);
    if (task && task.status !== status) {
      updateStatus({ uuid, status });
    }
  };

  const fromStr = filters.dateRange.start.toISOString().slice(0, 10);
  const toStr = filters.dateRange.end.toISOString().slice(0, 10);

  const isEmptyBoard = filtered.length === 0 && boardIncidents.length === 0;

  const isMd = useMatchMedia('(min-width: 768px)');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const wasMdRef = useRef(false);
  useEffect(() => {
    if (wasMdRef.current && !isMd) setFiltersOpen(false);
    wasMdRef.current = isMd;
  }, [isMd]);

  const filterGrid = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-3 sm:gap-y-2 lg:flex lg:flex-wrap lg:items-end">
      <div className="grid grid-cols-2 gap-2 sm:contents lg:flex lg:items-center lg:gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('filters.from')}
          <Input
            type="date"
            value={fromStr}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              onFiltersChange((prev) => ({
                ...prev,
                dateRange: { ...prev.dateRange, start: new Date(v + 'T12:00:00') },
              }));
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('filters.to')}
          <Input
            type="date"
            value={toStr}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              onFiltersChange((prev) => ({
                ...prev,
                dateRange: { ...prev.dateRange, end: new Date(v + 'T12:00:00') },
              }));
            }}
          />
        </label>
      </div>
      <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground sm:min-w-[140px]">
        {t('filters.status')}
        <Select
          value={filters.statusFilter}
          onChange={(e) =>
            onFiltersChange((prev) => ({
              ...prev,
              statusFilter: e.target.value as TaskFilters['statusFilter'],
            }))
          }
        >
          <option value="all">{t('filters.all')}</option>
          <option value="pending">{t('status.pending')}</option>
          <option value="in_progress">{t('status.in_progress')}</option>
          <option value="done">{t('status.done')}</option>
          <option value="issue">{t('status.issue')}</option>
        </Select>
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground sm:min-w-[140px]">
        {t('filters.priority')}
        <Select
          value={filters.priorityFilter}
          onChange={(e) =>
            onFiltersChange((prev) => ({
              ...prev,
              priorityFilter: e.target.value as TaskPriority | 'all',
            }))
          }
        >
          <option value="all">{t('filters.all')}</option>
          <option value="urgent">{t('priority.urgent')}</option>
          <option value="normal">{t('priority.normal')}</option>
          <option value="low">{t('priority.low')}</option>
        </Select>
      </label>
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground sm:min-w-[180px]">
        {t('filters.property')}
        <Input
          value={filters.propertyQuery}
          onChange={(e) => onFiltersChange((prev) => ({ ...prev, propertyQuery: e.target.value }))}
          placeholder={t('filters.propertyPlaceholder')}
        />
      </label>
    </div>
  );

  const viewButtons = (
    <div
      className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      role="toolbar"
      aria-label={t('viewModes.toolbarAria')}
    >
      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/30 p-1">
        {(
          [
            { id: 'list' as const, icon: LayoutList },
            { id: 'kanban' as const, icon: Kanban },
            { id: 'table' as const, icon: Table2 },
          ] as const
        ).map(({ id, icon: Icon }) => (
          <Button
            key={id}
            type="button"
            variant={view === id ? 'secondary' : 'ghost'}
            size="sm"
            className={cn(
              'gap-1.5 rounded-md px-2.5 sm:px-3',
              view === id && 'bg-background shadow-sm',
            )}
            onClick={() => setView(id)}
            aria-pressed={view === id}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="text-xs font-medium sm:text-sm">{t(`viewModes.${id}`)}</span>
          </Button>
        ))}
      </div>
      <p className="hidden max-w-sm text-xs leading-snug text-muted-foreground lg:block lg:text-right">
        {t('viewModes.hint')}
      </p>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {viewButtons}

      {isMd ? (
        filterGrid
      ) : filtersOpen ? (
        <div className="rounded-lg border border-border bg-muted/15 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{t('filters.mobileSummary')}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setFiltersOpen(false)}
              aria-label={t('filters.mobileClose')}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {filterGrid}
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full justify-between gap-2 px-3"
          onClick={() => setFiltersOpen(true)}
        >
          <span className="text-sm font-medium">{t('filters.mobileSummary')}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
        </Button>
      )}

      {isError && (
        <Alert variant="destructive">
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
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full max-w-md rounded-lg" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && !isError && view === 'list' && (
        <>
          {isEmptyBoard ? (
            <p className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
              {t('viewModes.listEmpty')}
            </p>
          ) : (
            <TaskListView
              byStatus={byStatus}
              boardIncidents={boardIncidents}
              onOpenTask={openTask}
              onOpenIncident={openIncident}
              onStatusChange={patchStatus}
            />
          )}
        </>
      )}

      {!isLoading && !isError && view === 'table' && (
        <div className="flex flex-col gap-4">
          {filtered.length === 0 && boardIncidents.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
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
