'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api/client';
import { useTasks, useUpdateTaskStatus } from '@/modules/tasks/hooks/useTasks';
import { usePendingTaskDelete } from '@/modules/tasks/hooks/usePendingTaskDelete';
import { usePendingTaskMarkDone } from '@/modules/tasks/hooks/usePendingTaskMarkDone';
import { useTaskFilters } from '@/modules/tasks/hooks/useTaskFilters';
import { TaskListView } from '@/modules/tasks/components/manager/TaskListView';
import { TaskDetailDrawer } from '@/modules/tasks/components/shared/TaskDetailDrawer';
import { parseTaskUuidFromTelegramStartParam } from '@/modules/tasks/utils/tma-start-param';
import { DEFAULT_TASK_FILTERS } from '@/stores/tasks-filters.store';
import type { Task, TaskStatus } from '@/modules/tasks/types';
import type { Incident } from '@/modules/incidents/hooks/useIncidents';

export function TmaStaffTasksPage() {
  const t = useTranslations('tma');
  const { data, isLoading, isError, refetch } = useTasks(DEFAULT_TASK_FILTERS);
  const filtered = useTaskFilters(data?.tasks ?? [], DEFAULT_TASK_FILTERS);
  const { mutate: updateStatus } = useUpdateTaskStatus();
  const { enqueueDeleteAfterSwipe } = usePendingTaskDelete({
    taskDeletedMessage: t('taskDeletedToast'),
    undoLabel: t('undoDelete'),
    deleteErrorMessage: t('taskDeleteError'),
  });
  const { enqueueMarkDoneAfterSwipe } = usePendingTaskMarkDone({
    taskMarkedMessage: t('taskMarkedDoneToast'),
    undoLabel: t('undoDelete'),
    markDoneErrorMessage: t('taskMarkDoneError'),
  });

  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const deepLinkHandledRef = useRef(false);

  useEffect(() => {
    if (deepLinkHandledRef.current) return;
    const sp = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    const taskId = parseTaskUuidFromTelegramStartParam(typeof sp === 'string' ? sp : undefined);
    if (!taskId) return;
    deepLinkHandledRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiClient.get<{ data: { task: Task } }>(`/tasks/${taskId}`);
        if (!cancelled) setDetailTask(res.data.data.task);
      } catch {
        deepLinkHandledRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patchStatus = useCallback(
    (uuid: string, status: TaskStatus) => {
      const task = filtered.find((x) => x.uuid === uuid) ?? data?.tasks?.find((x) => x.uuid === uuid);
      if (!task) return;
      if (task.status === status) return;
      void updateStatus({ uuid, status });
    },
    [filtered, data?.tasks, updateStatus],
  );

  const noopOpenIncident = useCallback((_i: Incident) => {
    /* STAFF list endpoint does not include incidents; board stays empty. */
  }, []);

  return (
    <div className="tasks-theme flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border/50 bg-background/90 px-3 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <h1 className="text-base font-semibold leading-tight">{t('tasksTitle')}</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 pb-6 pt-2 [-webkit-overflow-scrolling:touch]">
        {isLoading && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t('loading')}</p>
        )}
        {isError && (
          <p className="px-2 py-6 text-center text-sm text-destructive">
            <button type="button" className="underline" onClick={() => void refetch()}>
              {t('retry')}
            </button>
          </p>
        )}
        {!isLoading && !isError && filtered.length === 0 && (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">{t('emptyTasks')}</p>
        )}
        {!isLoading && !isError && filtered.length > 0 && (
          <TaskListView
            tasks={filtered}
            boardIncidents={[]}
            onOpenTask={setDetailTask}
            onOpenIncident={noopOpenIncident}
            onStatusChange={patchStatus}
            onSwipeDeleteTask={enqueueDeleteAfterSwipe}
            onSwipeMarkDone={enqueueMarkDoneAfterSwipe}
            voiceQuickAdd={false}
          />
        )}
      </div>

      <TaskDetailDrawer
        task={detailTask}
        open={!!detailTask}
        onOpenChange={(o) => !o && setDetailTask(null)}
        isStaffView
      />
    </div>
  );
}
