'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/navigation';
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
import { idEquals } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { useTasks, useUpdateTaskStatus, useTaskDetail } from '../../hooks/useTasks';
import { useTaskFilters } from '../../hooks/useTaskFilters';
import { useTasksViewMode } from '../../hooks/useTasksViewMode';
import type { PendingSupplyInterpretationEvent, Task, TaskFilters, TaskStatus } from '../../types';
import { usePendingSupplyInterpretations } from '../../hooks/usePendingSupplyInterpretations';
import { useSupplyMatrix } from '../../hooks/useSupplyMatrix';
import { KANBAN_COLUMNS } from '../../constants';
import { TaskCard } from './TaskCard';
import { TaskListView } from './TaskListView';
import { TaskDetailDrawer } from '../shared/TaskDetailDrawer';
import { useIncidents } from '@/modules/incidents/hooks/useIncidents';
import type { Incident } from '@/modules/incidents/hooks/useIncidents';
import { IncidentDetailDrawer } from '@/modules/incidents/components/IncidentDetailDrawer';
import { IncidentKanbanCard } from '@/modules/incidents/components/IncidentKanbanCard';
import { TooltipProvider } from '@/components/ui/tooltip';
import { KanbanBoardRail } from './KanbanBoardRail';
import { usePendingTaskDelete } from '../../hooks/usePendingTaskDelete';
import { usePendingTaskMarkDone } from '../../hooks/usePendingTaskMarkDone';
import { usePendingIncidentClose } from '@/modules/incidents/hooks/usePendingIncidentClose';
import {
  TASK_DETAIL_FOCUS_QUERY,
  TASK_DETAIL_FOCUS_STAFF_NOTES,
  TASK_DETAIL_URL_QUERY,
  TASK_INCIDENT_URL_QUERY,
  TASK_MANAGER_PANEL_QUERY,
} from '../../task-url-params';
import { ManagerBoardPanelTabs, parseManagerBoardPanel } from './ManagerBoardPanelTabs';
import { ManagerSupplyPanel } from './ManagerSupplyPanel';
import { ManagerSupplyToolbar } from './ManagerSupplyToolbar';
import { ManagerStaffMessagesPanel } from './ManagerStaffMessagesPanel';
import { useManagerUnseenStaffNotesCount } from '../../hooks/useManagerStaffNotesFeed';

export function ManagerKanban({ filters }: { filters: TaskFilters }) {
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const taskId = searchParams.get(TASK_DETAIL_URL_QUERY);
  const rawIncidentId = searchParams.get(TASK_INCIDENT_URL_QUERY);
  const incidentId = taskId ? null : rawIncidentId;
  const managerPanel = parseManagerBoardPanel(searchParams.get(TASK_MANAGER_PANEL_QUERY));
  const { data: unseenStaffNotesCount = 0 } = useManagerUnseenStaffNotesCount();

  const [supplyCatalogOpen, setSupplyCatalogOpen] = useState(false);
  const [supplyCreateOpen, setSupplyCreateOpen] = useState(false);
  const [supplyMatrixToolbarHost, setSupplyMatrixToolbarHost] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (managerPanel !== 'supply') {
      setSupplyMatrixToolbarHost(null);
    }
  }, [managerPanel]);

  const { view } = useTasksViewMode();
  const { data, isLoading, isError, refetch } = useTasks(filters, {
    enabled: managerPanel === 'tasks',
  });
  const { data: incidentsRaw, isLoading: incidentsLoading } = useIncidents({
    enabled: managerPanel === 'tasks',
  });
  const { data: supplyQueue = [] } = usePendingSupplyInterpretations({
    enabled: managerPanel === 'tasks',
  });
  const { data: supplyMatrixRows = [] } = useSupplyMatrix(managerPanel === 'tasks');
  const supplyBadgeCount = Math.max(supplyMatrixRows.length, supplyQueue.length);
  const filtered = useTaskFilters(data?.tasks ?? [], filters);
  const { mutate: updateStatus } = useUpdateTaskStatus();

  const listTask = useMemo((): Task | null => {
    if (!taskId) return null;
    return data?.tasks?.find((x) => idEquals(x.uuid, taskId)) ?? null;
  }, [taskId, data?.tasks]);

  const { data: taskDetail, isError: taskDetailError } = useTaskDetail(taskId, {
    enabled: Boolean(taskId),
    placeholderData: listTask,
  });

  const detailTask = useMemo((): Task | null => {
    if (!taskId) return null;
    if (taskDetail && idEquals(taskDetail.uuid, taskId)) return taskDetail;
    return listTask;
  }, [taskId, taskDetail, listTask]);

  const detailIncident = useMemo((): Incident | null => {
    if (!incidentId) return null;
    return incidentsRaw?.find((x) => x.uuid === incidentId) ?? null;
  }, [incidentId, incidentsRaw]);

  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const clearTaskFromUrl = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(TASK_DETAIL_URL_QUERY);
    params.delete(TASK_DETAIL_FOCUS_QUERY);
    const q = params.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }, [pathname, router, searchParams]);

  const clearIncidentFromUrl = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(TASK_INCIDENT_URL_QUERY);
    const q = params.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (taskId && rawIncidentId) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete(TASK_INCIDENT_URL_QUERY);
      const q = params.toString();
      router.replace(q ? `${pathname}?${q}` : pathname);
    }
  }, [taskId, rawIncidentId, pathname, router, searchParams]);

  /** Раньше: задача не в ответе списка (другой исполнитель при фильтре доски) → сразу закрывали URL. Теперь источник карточки — GET /tasks/:uuid (useTaskDetail). */
  useEffect(() => {
    if (!taskId || isLoading) return;
    if (data?.tasks?.some((x) => idEquals(x.uuid, taskId))) return;
    if (taskDetailError) clearTaskFromUrl();
  }, [taskId, isLoading, data?.tasks, taskDetailError, clearTaskFromUrl]);

  useEffect(() => {
    if (!incidentId || incidentsLoading) return;
    if (incidentsRaw && !incidentsRaw.some((x) => x.uuid === incidentId)) {
      clearIncidentFromUrl();
    }
  }, [incidentId, incidentsLoading, incidentsRaw, clearIncidentFromUrl]);

  const boardIncidents = useMemo(() => {
    if (!incidentsRaw?.length) return [];
    const start = new Date(filters.dateRange.start);
    start.setHours(0, 0, 0, 0);
    const end = new Date(filters.dateRange.end);
    end.setHours(23, 59, 59, 999);
    const q = filters.propertyQuery.trim().toLowerCase();
    return incidentsRaw.filter((i) => {
      const isResolved = i.status === 'resolved' || i.status === 'closed';

      if (filters.statusFilter === 'done') {
        if (!isResolved) return false;
      } else if (filters.statusFilter === 'all') {
        if (isResolved) return false;
      } else if (filters.statusFilter === 'pending') {
        if (i.status !== 'open' && i.status !== 'awaiting_dispatch') return false;
      } else if (filters.statusFilter === 'in_progress') {
        if (i.status !== 'assigned' && i.status !== 'in_review') return false;
      } else if (filters.statusFilter === 'issue') {
        if (isResolved) return false;
      } else {
        if (isResolved) return false;
      }

      if (filters.priorityFilter !== 'all') {
        return false;
      }

      if (filters.dateRangeEnabled) {
        const t0 = new Date(i.createdAt).getTime();
        if (t0 < start.getTime() || t0 > end.getTime()) return false;
      }
      if (q && !i.propertyTitle.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [
    incidentsRaw,
    filters.dateRange,
    filters.dateRangeEnabled,
    filters.propertyQuery,
    filters.statusFilter,
    filters.priorityFilter,
  ]);

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

  const openTask = useCallback(
    (task: Task, opts?: { focusStaffNotes?: boolean }) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete(TASK_INCIDENT_URL_QUERY);
      params.set(TASK_DETAIL_URL_QUERY, task.uuid);
      if (opts?.focusStaffNotes) {
        params.set(TASK_DETAIL_FOCUS_QUERY, TASK_DETAIL_FOCUS_STAFF_NOTES);
      } else {
        params.delete(TASK_DETAIL_FOCUS_QUERY);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const openTaskById = useCallback(
    (taskUuid: string, opts?: { focusStaffNotes?: boolean }) => {
      const found = data?.tasks?.find((x) => idEquals(x.uuid, taskUuid));
      if (found) {
        openTask(found, opts);
        return;
      }
      const params = new URLSearchParams(searchParams.toString());
      params.delete(TASK_INCIDENT_URL_QUERY);
      params.set(TASK_DETAIL_URL_QUERY, taskUuid);
      if (opts?.focusStaffNotes) {
        params.set(TASK_DETAIL_FOCUS_QUERY, TASK_DETAIL_FOCUS_STAFF_NOTES);
      } else {
        params.delete(TASK_DETAIL_FOCUS_QUERY);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [data?.tasks, openTask, pathname, router, searchParams],
  );

  const openIncident = useCallback(
    (incident: Incident) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete(TASK_DETAIL_URL_QUERY);
      params.delete(TASK_DETAIL_FOCUS_QUERY);
      params.set(TASK_INCIDENT_URL_QUERY, incident.uuid);
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const openSupplyInterpretation = useCallback(
    (e: PendingSupplyInterpretationEvent) => {
      const params = new URLSearchParams(searchParams.toString());
      if (e.targetType === 'incident') {
        params.delete(TASK_DETAIL_URL_QUERY);
        params.set(TASK_INCIDENT_URL_QUERY, e.targetId);
      } else {
        params.delete(TASK_INCIDENT_URL_QUERY);
        params.set(TASK_DETAIL_URL_QUERY, e.targetId);
      }
      params.delete(TASK_DETAIL_FOCUS_QUERY);
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

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

  /** Очередь нехватки всегда в списке — пустой борд только если нет задач и инцидентов. */
  const isEmptyBoard = filtered.length === 0 && boardIncidents.length === 0;
  const tasksBoardLoading = managerPanel === 'tasks' && (isLoading || incidentsLoading);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden md:gap-3">
      <ManagerBoardPanelTabs
        panel={managerPanel}
        supplyBadgeCount={supplyBadgeCount}
        staffMessagesBadgeCount={unseenStaffNotesCount}
        endContent={
          managerPanel === 'supply' ? (
            <ManagerSupplyToolbar
              catalogOpen={supplyCatalogOpen}
              onCatalogOpenChange={setSupplyCatalogOpen}
              onCreateClick={() => setSupplyCreateOpen(true)}
              matrixToolbarHostRef={setSupplyMatrixToolbarHost}
            />
          ) : undefined
        }
      />
      {managerPanel === 'tasks' && isError && (
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

      {tasksBoardLoading && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <Skeleton className="h-10 w-full max-w-md shrink-0 rounded-lg" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full shrink-0 rounded-xl" />
          ))}
        </div>
      )}

      {managerPanel === 'tasks' && !isLoading && !isError && view === 'list' && (
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
                boardShortage={supplyQueue}
                onOpenTask={openTask}
                onOpenIncident={openIncident}
                onOpenSupplyInterpretation={openSupplyInterpretation}
                onStatusChange={patchStatus}
                onSwipeDeleteTask={enqueueDeleteAfterSwipe}
                onSwipeMarkDone={enqueueMarkDoneAfterSwipe}
                onSwipeCloseIncident={enqueueCloseAfterSwipe}
              />
            </div>
          )}
        </div>
      )}

      {managerPanel === 'tasks' && !isLoading && !isError && view === 'kanban' && (
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

      {managerPanel === 'supply' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ManagerSupplyPanel
            catalogOpen={supplyCatalogOpen}
            onCatalogOpenChange={setSupplyCatalogOpen}
            createSupplyOpen={supplyCreateOpen}
            onCreateSupplyOpenChange={setSupplyCreateOpen}
            matrixToolbarHost={supplyMatrixToolbarHost}
          />
        </div>
      )}

      {managerPanel === 'staffMessages' && (
        <ManagerStaffMessagesPanel onOpenTask={openTaskById} />
      )}

      <TaskDetailDrawer
        task={detailTask}
        open={Boolean(taskId && detailTask)}
        focusStaffNotes={
          searchParams.get(TASK_DETAIL_FOCUS_QUERY) === TASK_DETAIL_FOCUS_STAFF_NOTES
        }
        onOpenChange={(o) => {
          if (!o) clearTaskFromUrl();
        }}
      />
      <IncidentDetailDrawer
        incident={detailIncident}
        open={Boolean(incidentId && detailIncident)}
        onOpenChange={(o) => {
          if (!o) clearIncidentFromUrl();
        }}
        onOpenRelatedTask={(taskUuid) => {
          const params = new URLSearchParams(searchParams.toString());
          params.delete(TASK_INCIDENT_URL_QUERY);
          params.set(TASK_DETAIL_URL_QUERY, taskUuid);
          params.delete(TASK_DETAIL_FOCUS_QUERY);
          router.push(`${pathname}?${params.toString()}`);
        }}
      />
    </div>
  );
}
