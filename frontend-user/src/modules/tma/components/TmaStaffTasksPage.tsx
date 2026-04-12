'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { apiClient } from '@/lib/api/client';
import { useTasks, useUpdateTaskStatus } from '@/modules/tasks/hooks/useTasks';
import { usePendingTaskDelete } from '@/modules/tasks/hooks/usePendingTaskDelete';
import { usePendingTaskMarkDone } from '@/modules/tasks/hooks/usePendingTaskMarkDone';
import { useTaskFilters } from '@/modules/tasks/hooks/useTaskFilters';
import { TaskListView } from '@/modules/tasks/components/manager/TaskListView';
import { TaskDetailDrawer } from '@/modules/tasks/components/shared/TaskDetailDrawer';
import { parseTaskUuidFromTelegramStartParam } from '@/modules/tasks/utils/tma-start-param';
import { TASK_DETAIL_URL_QUERY } from '@/modules/tasks/task-url-params';
import { DEFAULT_TASK_FILTERS } from '@/stores/tasks-filters.store';
import type { PendingSupplyInterpretationEvent, Task, TaskStatus } from '@/modules/tasks/types';
import type { Incident } from '@/modules/incidents/hooks/useIncidents';

export function TmaStaffTasksPage() {
  const t = useTranslations('tma');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const taskId = searchParams.get(TASK_DETAIL_URL_QUERY);

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

  /** When task is not in the list payload, load by id (Telegram deep link / shared URL). */
  const [fetchedTask, setFetchedTask] = useState<Task | null>(null);
  const deepLinkSyncedRef = useRef(false);

  const taskFromList = useMemo(() => {
    if (!taskId) return null;
    return data?.tasks?.find((x) => x.uuid === taskId) ?? null;
  }, [taskId, data?.tasks]);

  const clearTaskFromUrl = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(TASK_DETAIL_URL_QUERY);
    const q = params.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }, [pathname, router, searchParams]);

  const detailTask = useMemo((): Task | null => {
    if (!taskId) return null;
    if (taskFromList) return taskFromList;
    if (fetchedTask?.uuid === taskId) return fetchedTask;
    return null;
  }, [taskId, taskFromList, fetchedTask]);

  useEffect(() => {
    if (!taskId) {
      setFetchedTask(null);
      return;
    }
    if (taskFromList) setFetchedTask(null);
  }, [taskId, taskFromList]);

  /** Telegram start_param → same `?task=` as dashboard (system «back» pops detail first). */
  useEffect(() => {
    if (deepLinkSyncedRef.current) return;
    const sp = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    const id = parseTaskUuidFromTelegramStartParam(typeof sp === 'string' ? sp : undefined);
    if (!id) return;
    deepLinkSyncedRef.current = true;
    const params = new URLSearchParams(searchParams.toString());
    if (params.get(TASK_DETAIL_URL_QUERY) === id) return;
    params.set(TASK_DETAIL_URL_QUERY, id);
    router.replace(`${pathname}?${params.toString()}`);
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!taskId || taskFromList || isLoading) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiClient.get<{ data: { task: Task } }>(`/tasks/${taskId}`);
        if (!cancelled) setFetchedTask(res.data.data.task);
      } catch {
        if (!cancelled) clearTaskFromUrl();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, taskFromList, isLoading, clearTaskFromUrl]);

  const openTask = useCallback(
    (task: Task) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(TASK_DETAIL_URL_QUERY, task.uuid);
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

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

  const noopOpenSupply = useCallback((_e: PendingSupplyInterpretationEvent) => {
    void _e;
    /* Manager-only supply queue — not used in TMA staff list. */
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
            boardShortage={[]}
            showShortageWhenEmpty={false}
            onOpenTask={openTask}
            onOpenIncident={noopOpenIncident}
            onOpenSupplyInterpretation={noopOpenSupply}
            onStatusChange={patchStatus}
            onSwipeDeleteTask={enqueueDeleteAfterSwipe}
            onSwipeMarkDone={enqueueMarkDoneAfterSwipe}
            voiceQuickAdd={false}
          />
        )}
      </div>

      <TaskDetailDrawer
        task={detailTask}
        open={Boolean(taskId && detailTask)}
        onOpenChange={(o) => {
          if (!o) clearTaskFromUrl();
        }}
        isStaffView
      />
    </div>
  );
}
