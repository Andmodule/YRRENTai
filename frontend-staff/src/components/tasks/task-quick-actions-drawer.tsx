'use client';

import { Play, CheckCircle2, AlertCircle, MessageSquareText } from 'lucide-react';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import type { Task } from '@/hooks/use-tasks';
import { useStaffStrings } from '@/locales/staff-strings';

const typeLabels: Record<string, string> = {
  checkout_cleaning: 'Уборка (выезд)',
  checkin_prep: 'Подготовка к заезду',
  mid_stay_cleaning: 'Плановая уборка',
  manual: 'Задача',
};

interface TaskQuickActionsDrawerProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (uuid: string) => void;
  onMarkDone: (task: Task) => void;
  onMarkIssue: (uuid: string) => void;
  onOpenDetails: (task: Task) => void;
  startPending?: boolean;
}

export function TaskQuickActionsDrawer({
  task,
  open,
  onOpenChange,
  onStart,
  onMarkDone,
  onMarkIssue,
  onOpenDetails,
  startPending = false,
}: TaskQuickActionsDrawerProps) {
  const ti = useStaffStrings().tasks.taskIssue;
  if (!task) return null;

  const isDone = task.status === 'done';
  const isIssue = task.status === 'issue';
  const isPending = task.status === 'pending';
  const canComplete = !isDone && !isIssue;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title="Действия по задаче">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">
              {typeLabels[task.type] ?? task.type}
            </p>
            <p className="mt-1 text-lg font-bold text-slate-900">{task.propertyTitle}</p>
            {task.contextLabel ? (
              <p className="mt-2 rounded-xl border border-teal-100 bg-teal-50/90 px-3 py-2 text-sm text-teal-900">
                {task.contextLabel}
              </p>
            ) : null}
            {task.dueTime ? (
              <p className="mt-2 text-sm text-slate-600">До {task.dueTime}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            {isPending && (
              <Button
                className="h-12 w-full justify-center gap-2 rounded-xl text-base"
                disabled={startPending}
                onClick={() => onStart(task.uuid)}
              >
                <Play className="h-5 w-5" />
                Начать
              </Button>
            )}
            {canComplete && (
              <Button
                className="h-12 w-full justify-center gap-2 rounded-xl text-base bg-emerald-600 hover:bg-emerald-700"
                onClick={() => onMarkDone(task)}
              >
                <CheckCircle2 className="h-5 w-5" />
                Готово
              </Button>
            )}
            {!isDone && !isIssue && (
              <Button
                variant="outline"
                className="h-12 w-full justify-center gap-2 rounded-xl text-base border-amber-200 text-amber-900 hover:bg-amber-50"
                onClick={() => onMarkIssue(task.uuid)}
              >
                <AlertCircle className="h-5 w-5" />
                {ti.quickActionLabel}
              </Button>
            )}
            <Button
              variant="ghost"
              className="h-11 w-full gap-2 text-slate-700"
              onClick={() => {
                onOpenChange(false);
                onOpenDetails(task);
              }}
            >
              <MessageSquareText className="h-4 w-4" />
              Заметки и детали
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
