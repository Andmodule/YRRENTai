'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useTasks, useUpdateTaskStatus } from '../../hooks/useTasks';
import { useTaskFilters } from '../../hooks/useTaskFilters';
import type { Task, TaskFilters, TaskPriority, TaskStatus } from '../../types';
import { KANBAN_COLUMNS } from '../../constants';
import { KanbanColumn } from './KanbanColumn';
import { TaskCard } from './TaskCard';
import { TaskDetailDrawer } from '../shared/TaskDetailDrawer';
import { useIncidents } from '@/modules/incidents/hooks/useIncidents';
import type { Incident } from '@/modules/incidents/hooks/useIncidents';
import { IncidentDetailDrawer } from '@/modules/incidents/components/IncidentDetailDrawer';
import { TooltipProvider } from '@/components/ui/tooltip';

export function ManagerKanban({
  filters,
  onFiltersChange,
}: {
  filters: TaskFilters;
  onFiltersChange: (f: TaskFilters | ((prev: TaskFilters) => TaskFilters)) => void;
}) {
  const t = useTranslations('tasks');
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
      const t = new Date(i.createdAt).getTime();
      if (t < start.getTime() || t > end.getTime()) return false;
      if (q && !i.propertyTitle.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [incidentsRaw, filters.dateRange, filters.propertyQuery]);

  useEffect(() => {
    if (!detailIncident || !incidentsRaw) return;
    const next = incidentsRaw.find((x) => x.uuid === detailIncident.uuid);
    if (next) setDetailIncident(next);
  }, [incidentsRaw, detailIncident?.uuid]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
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

  const fromStr = filters.dateRange.start.toISOString().slice(0, 10);
  const toStr = filters.dateRange.end.toISOString().slice(0, 10);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="grid gap-2 sm:grid-cols-2 lg:flex lg:items-center lg:gap-2">
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
        <label className="flex min-w-[140px] flex-col gap-1 text-xs font-medium text-muted-foreground">
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
        <label className="flex min-w-[140px] flex-col gap-1 text-xs font-medium text-muted-foreground">
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
        <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('filters.property')}
          <Input
            value={filters.propertyQuery}
            onChange={(e) => onFiltersChange((prev) => ({ ...prev, propertyQuery: e.target.value }))}
            placeholder={t('filters.propertyPlaceholder')}
          />
        </label>
      </div>

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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && !isError && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <TooltipProvider delayDuration={200}>
            <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
            {KANBAN_COLUMNS.map((col) => (
              <KanbanColumn
                key={col.status}
                column={col}
                tasks={byStatus[col.status]}
                onOpenTask={(t) => {
                  setDetailIncident(null);
                  setDetailTask(t);
                }}
                incidents={col.status === 'issue' ? boardIncidents : undefined}
                onOpenIncident={
                  col.status === 'issue'
                    ? (i) => {
                        setDetailTask(null);
                        setDetailIncident(i);
                      }
                    : undefined
                }
                incidentColumnHint={col.status === 'issue'}
              />
            ))}
            </div>
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
