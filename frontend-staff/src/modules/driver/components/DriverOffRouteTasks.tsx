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
import { AlertCircle } from 'lucide-react';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer';

export interface DriverOffRouteTasksProps {
  routePropertyIds: string[];
  onVoiceForTask?: (task: Task) => void;
  onTextForTask?: (task: Task) => void;
}

export function DriverOffRouteTasks({ routePropertyIds, onVoiceForTask, onTextForTask }: DriverOffRouteTasksProps) {
  const strings = useStaffStrings();
  const { data, isLoading } = useTodayTasks();
  const { mutate: updateStatus, isPending: statusPending } = useUpdateTaskStatus();

  const offRouteTasks = useMemo(() => {
    const set = new Set(routePropertyIds);
    return (data?.tasks ?? [])
      .filter((t) => t.status !== 'done' && !set.has(t.propertyId))
      .sort((a, b) => {
        const pr: Record<string, number> = { urgent: 0, normal: 1 };
        const pa = pr[a.priority] ?? 1;
        const pb = pr[b.priority] ?? 1;
        if (pa !== pb) return pa - pb;
        return (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99');
      });
  }, [data?.tasks, routePropertyIds]);

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
      const t = offRouteTasks.find((x) => x.uuid === uuid);
      if (t) enqueueMarkDoneAfterSwipe(t);
    },
    [offRouteTasks, enqueueMarkDoneAfterSwipe],
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
    const t = offRouteTasks.find((x) => x.uuid === uuid);
    if (t) setIssueTask(t);
  };

  if (isLoading || offRouteTasks.length === 0) return null;

  return (
    <>
      <Drawer>
        <DrawerTrigger asChild>
          <button
            type="button"
            className="fixed bottom-14 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-teal-600 text-white shadow-lg shadow-teal-900/25 ring-2 ring-white/90 transition-transform active:scale-95 dark:ring-slate-900/80"
            aria-label="Задачи вне маршрута"
          >
            <div className="relative inline-flex">
              <AlertCircle className="h-7 w-7" strokeWidth={2.25} aria-hidden />
              <span className="absolute -right-0.5 -top-0.5 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white shadow-sm ring-2 ring-teal-600">
                {offRouteTasks.length > 99 ? '99+' : offRouteTasks.length}
              </span>
            </div>
          </button>
        </DrawerTrigger>
        <DrawerContent
          title="Задачи вне маршрута"
          bodyClassName="!p-0 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 min-h-[60vh]"
        >
          <ul className="flex flex-col gap-3">
            {offRouteTasks.map((task) => (
              <li key={task.uuid} className="list-none">
                <ChecklistItem
                  task={task}
                  deadlineUrgency={deadlineUrgency(task)}
                  onMarkDone={handleMarkDone}
                  onQuickOpen={setQuickTask}
                  onVoiceForTask={onVoiceForTask}
                  onTextForTask={onTextForTask}
                />
              </li>
            ))}
          </ul>
        </DrawerContent>
      </Drawer>

      <TaskQuickActionsDrawer
        task={quickTask}
        open={!!quickTask}
        onOpenChange={(o) => !o && setQuickTask(null)}
        onStart={handleQuickStart}
        onMarkDone={handleMarkDoneTask}
        onMarkIssue={handleQuickIssue}
        onOpenDetails={(t) => setDetailTask(t)}
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
