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

export function DriverPropertyTasks({ propertyId, onVoiceForTask, onTextForTask }: DriverPropertyTasksProps) {
  const strings = useStaffStrings();
  const { data, isLoading } = useTodayTasks();
  const { mutate: updateStatus, isPending: statusPending } = useUpdateTaskStatus();

  const activeTasks = useMemo(() => {
    return (data?.tasks ?? [])
      .filter((t) => t.propertyId === propertyId && t.status !== 'done')
      .sort((a, b) => {
        const pr: Record<string, number> = { urgent: 0, normal: 1 };
        const pa = pr[a.priority] ?? 1;
        const pb = pr[b.priority] ?? 1;
        if (pa !== pb) return pa - pb;
        return (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99');
      });
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

  const { enqueueMarkDoneAfterSwipe } = usePendingTaskMarkDoneStaff({
    taskMarkedMessage: strings.tasks.checklist.taskMarkedDoneToast,
    undoLabel: strings.tasks.checklist.undoMarkDone,
    markDoneErrorMessage: strings.tasks.checklist.markDoneError,
    onCommitted: onMarkDoneCommitted,
    onChecklistIncomplete: onMarkDoneChecklistIncomplete,
  });

  const handleMarkDone = useCallback(
    (uuid: string) => {
      const t = activeTasks.find((x) => x.uuid === uuid);
      if (t) enqueueMarkDoneAfterSwipe(t);
    },
    [activeTasks, enqueueMarkDoneAfterSwipe],
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
    const t = activeTasks.find((x) => x.uuid === uuid);
    if (t) setIssueTask(t);
  };

  if (isLoading) return null;
  if (activeTasks.length === 0) return null;

  return (
    <>
      <div className="mt-6 flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Задачи на объекте</h3>
        {activeTasks.map((task) => (
          <ChecklistItem
            key={task.uuid}
            task={task}
            deadlineUrgency={deadlineUrgency(task)}
            onMarkDone={handleMarkDone}
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
        onOpenDetails={(t) => setDetailTask(t)}
        startPending={statusPending}
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
