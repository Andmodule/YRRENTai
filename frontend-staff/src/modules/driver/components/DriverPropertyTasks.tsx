'use client';

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTodayTasks, useUpdateTaskStatus } from '@/hooks/use-tasks';
import { usePendingTaskMarkDoneStaff } from '@/hooks/use-pending-task-mark-done';
import { ChecklistItem } from '@/components/tasks/checklist-item';
import { TaskQuickActionsDrawer } from '@/components/tasks/task-quick-actions-drawer';
import { TaskDetailStaff } from '@/components/tasks/task-detail-staff';
import { PhotoVerificationDrawer } from '@/components/tasks/photo-verification-drawer';
import { IssueDrawer } from '@/components/tasks/issue-drawer';
import { useStaffStrings } from '@/locales/staff-strings';
import { deadlineUrgency } from '@/lib/shift-utils';
import type { Task } from '@/hooks/use-tasks';

export interface DriverPropertyTasksProps {
  propertyId: string;
  onVoiceForTask?: (task: Task) => void;
  onTextForTask?: (task: Task) => void;
}

function sortOpenPropertyTasksForDriver(a: Task, b: Task): number {
  const pr: Record<string, number> = { urgent: 0, normal: 1 };
  const pa = pr[a.priority] ?? 1;
  const pb = pr[b.priority] ?? 1;
  if (pa !== pb) return pa - pb;
  return (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99');
}

/** Сначала невыполненные, затем «готово»; на активной точке готовые не скрываем — зачёркивание, пока не закрыли остановку. */
function sortPropertyTasksOnRoute(a: Task, b: Task): number {
  const aDone = a.status === 'done' ? 1 : 0;
  const bDone = b.status === 'done' ? 1 : 0;
  if (aDone !== bDone) return aDone - bDone;
  if (aDone === 0) return sortOpenPropertyTasksForDriver(a, b);
  return (b.completedAt ?? '').localeCompare(a.completedAt ?? '');
}

export function DriverPropertyTasks({ propertyId, onVoiceForTask, onTextForTask }: DriverPropertyTasksProps) {
  const strings = useStaffStrings();
  const tr = strings.driver.route;
  const { data, isLoading } = useTodayTasks();
  const { mutate: updateStatus, isPending: statusPending } = useUpdateTaskStatus();

  const displayTasks = useMemo(() => {
    return (data?.tasks ?? []).filter((t) => t.propertyId === propertyId).sort(sortPropertyTasksOnRoute);
  }, [data?.tasks, propertyId]);

  const [quickTask, setQuickTask] = useState<Task | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [issueTask, setIssueTask] = useState<Task | null>(null);
  const [photoTaskUuid, setPhotoTaskUuid] = useState<string | null>(null);
  const [checklistScrollNonce, setChecklistScrollNonce] = useState(0);

  const onMarkDoneCommitted = useCallback((task: Task) => {
    setQuickTask(null);
    setPhotoTaskUuid(task.uuid);
  }, []);

  const onMarkDoneChecklistIncomplete = useCallback(
    (task: Task) => {
      toast.warning(strings.tasks.checklist.completeRequired);
      setQuickTask(null);
      setDetailTask(task);
      setChecklistScrollNonce((n) => n + 1);
    },
    [strings.tasks.checklist.completeRequired],
  );

  const { enqueueMarkDoneAfterSwipe, cancelPendingForUuid } = usePendingTaskMarkDoneStaff({
    markDoneErrorMessage: strings.tasks.checklist.markDoneError,
    onCommitted: onMarkDoneCommitted,
    onChecklistIncomplete: onMarkDoneChecklistIncomplete,
  });

  const handleMarkDone = useCallback(
    (uuid: string) => {
      const t = (data?.tasks ?? []).find(
        (x) => x.uuid === uuid && x.propertyId === propertyId && x.status !== 'done',
      );
      if (t) enqueueMarkDoneAfterSwipe(t);
    },
    [data?.tasks, propertyId, enqueueMarkDoneAfterSwipe],
  );

  const handleMarkReopen = useCallback(
    (uuid: string) => {
      cancelPendingForUuid(uuid);
      const t = (data?.tasks ?? []).find((x) => x.uuid === uuid);
      if (t?.status === 'done') {
        updateStatus({ uuid, status: 'pending' });
      }
    },
    [data?.tasks, cancelPendingForUuid, updateStatus],
  );

  const handleMarkDoneTask = useCallback(
    (task: Task) => {
      enqueueMarkDoneAfterSwipe(task);
    },
    [enqueueMarkDoneAfterSwipe],
  );

  const handleQuickStart = (uuid: string) => {
    updateStatus(
      { uuid, status: 'in_progress' },
      { onSuccess: () => setQuickTask(null) },
    );
  };

  const handleQuickIssue = (uuid: string) => {
    setQuickTask(null);
    const t = (data?.tasks ?? []).find(
      (x) => x.uuid === uuid && x.propertyId === propertyId && x.status !== 'done',
    );
    if (t) setIssueTask(t);
  };

  if (isLoading) return null;
  if (displayTasks.length === 0) return null;

  return (
    <>
      <div className="mt-5 flex w-full min-w-0 max-w-full flex-col gap-2">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{tr.propertyTasksSectionTitle}</h3>
        {displayTasks.map((task) => (
          <ChecklistItem
            key={task.uuid}
            task={task}
            variant="driverRoute"
            deadlineUrgency={deadlineUrgency(task)}
            onMarkDone={handleMarkDone}
            onMarkReopen={handleMarkReopen}
            onQuickOpen={setQuickTask}
            onVoiceForTask={onVoiceForTask}
            onTextForTask={onTextForTask}
          />
        ))}
      </div>

      <TaskQuickActionsDrawer
        task={quickTask}
        open={!!quickTask}
        onOpenChange={(o) => !o && setQuickTask(null)}
        onStart={handleQuickStart}
        onMarkDone={handleMarkDoneTask}
        onMarkIssue={handleQuickIssue}
        onMarkReopen={(t) => handleMarkReopen(t.uuid)}
        onOpenDetails={(t) => setDetailTask(t)}
        onAddVerification={(t) => {
          setPhotoTaskUuid(t.uuid);
        }}
        startPending={statusPending}
        readOnlyActions={true}
      />

      <TaskDetailStaff
        task={detailTask}
        open={!!detailTask}
        onClose={() => setDetailTask(null)}
        checklistScrollNonce={checklistScrollNonce}
      />

      <PhotoVerificationDrawer
        taskUuid={photoTaskUuid}
        open={!!photoTaskUuid}
        variant="default"
        onOpenChange={(o) => {
          if (!o) {
            setPhotoTaskUuid(null);
          }
        }}
      />

      <IssueDrawer
        task={issueTask}
        open={!!issueTask}
        onOpenChange={(o) => !o && setIssueTask(null)}
      />
    </>
  );
}
