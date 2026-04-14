'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import { format, startOfDay, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  CalendarDays,
  ClipboardList,
  LogOut,
  PartyPopper,
  Sparkles,
  Wifi,
  WifiOff,
  Route,
  Play,
  AlertTriangle,
  Mic,
} from 'lucide-react';
import { useTodayTasks } from '@/hooks/use-tasks';
import { useTasksSocket } from '@/hooks/use-tasks-socket';
import type { Task } from '@/hooks/use-tasks';
import type { StaffUser } from '@/hooks/use-auth';
import { useUpdateTaskStatus, useCompleteShift } from '@/hooks/use-tasks';
import { usePendingTaskMarkDoneStaff } from '@/hooks/use-pending-task-mark-done';
import { ChecklistItem } from './checklist-item';
import { ProgressBar } from './progress-bar';
import { IssueDrawer } from './issue-drawer';
import { PhotoVerificationDrawer } from './photo-verification-drawer';
import { TaskDetailStaff } from './task-detail-staff';
import { TaskQuickActionsDrawer } from './task-quick-actions-drawer';
import { IncidentReportDrawer } from './incident-report-drawer';
import {
  StaffVoiceReportSheet,
  type StaffVoiceMode,
  type StaffVoiceReportSheetHandle,
} from './staff-voice-report-sheet';
import {
  StaffHistoryDrawer,
  StaffHistoryFab,
  StaffIncidentPhotoAppendDrawer,
} from './staff-history-drawer';
import {
  StaffHistorySupplementSheet,
  type StaffSupplementContext,
} from './staff-history-supplement-sheet';
import { StaffDeliveryRoutePanel } from './staff-delivery-route-panel';
import { useStaffStrings } from '@/locales/staff-strings';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import {
  deadlineUrgency,
  estimateShiftEnd,
  isShiftDoneToday,
  pickNextTaskByDueTime,
  formatShiftDurationLabel,
} from '@/lib/shift-utils';
interface StaffChecklistProps {
  user: StaffUser;
  onLogout: () => void;
}

export function StaffChecklist({ user, onLogout }: StaffChecklistProps) {
  useTasksSocket(user.id);
  const strings = useStaffStrings();

  const today = useMemo(() => startOfDay(new Date()), []);
  const todayStr = format(today, 'yyyy-MM-dd');
  const dateLabel = format(today, 'EEEE, d MMMM', { locale: ru });

  const { data, isLoading, isError, refetch } = useTodayTasks();
  const { mutate: updateStatus, isPending: statusPending } = useUpdateTaskStatus();
  const { mutateAsync: completeShift, isPending: shiftPending } = useCompleteShift();

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

  const [issueTask, setIssueTask] = useState<Task | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [quickTask, setQuickTask] = useState<Task | null>(null);
  const [photoTaskUuid, setPhotoTaskUuid] = useState<string | null>(null);
  const [photoSupplement, setPhotoSupplement] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [supplementCtx, setSupplementCtx] = useState<StaffSupplementContext | null>(null);
  const [incidentPhotoUuid, setIncidentPhotoUuid] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [voiceSheetOpen, setVoiceSheetOpen] = useState(false);
  const [voiceSheetMode, setVoiceSheetMode] = useState<StaffVoiceMode>('TASK');
  /** Явная привязка голоса к карточке; иначе — «якорь» следующей задачи (FAB). */
  const [voicePinnedTaskUuid, setVoicePinnedTaskUuid] = useState<string | null>(null);
  const voiceSheetRef = useRef<StaffVoiceReportSheetHandle>(null);
  const [checklistScrollNonce, setChecklistScrollNonce] = useState(0);
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    const key = `staffShiftStart_${todayStr}`;
    if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, String(Date.now()));
    }
  }, [todayStr]);

  const todayTasks = useMemo(() => {
    const list = (data?.tasks ?? []).filter((t) => t.dueDate === todayStr);
    const pr: Record<string, number> = { urgent: 0, normal: 1, low: 2 };
    return [...list].sort((a, b) => {
      const pa = pr[a.priority] ?? 1;
      const pb = pr[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      return (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99');
    });
  }, [data?.tasks, todayStr]);

  /** Как в TMA: невыполненные задачи на любую дату из ответа API (широкий диапазон дат). */
  const activeTasks = useMemo(() => {
    const list = (data?.tasks ?? []).filter((t) => t.status !== 'done');
    const pr: Record<string, number> = { urgent: 0, normal: 1, low: 2 };
    return [...list].sort((a, b) => {
      const dd = a.dueDate.localeCompare(b.dueDate);
      if (dd !== 0) return dd;
      const pa = pr[a.priority] ?? 1;
      const pb = pr[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      return (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99');
    });
  }, [data?.tasks]);

  const resolveTaskByUuid = useCallback(
    (uuid: string) =>
      activeTasks.find((t) => t.uuid === uuid) ??
      todayTasks.find((t) => t.uuid === uuid) ??
      data?.tasks?.find((t) => t.uuid === uuid) ??
      null,
    [activeTasks, todayTasks, data?.tasks],
  );

  const doneCount = todayTasks.filter((t) => t.status === 'done').length;
  const verifiedCount = todayTasks.filter((t) => t.status === 'done' && t.hasVerificationPhoto).length;
  const total = todayTasks.length;
  const allDone = total > 0 && doneCount === total;
  const shiftEst = estimateShiftEnd(todayTasks);

  const nextTask = useMemo(() => pickNextTaskByDueTime(activeTasks), [activeTasks]);
  /** Контекст голосового отчёта с FAB: следующая по времени или первая в списке. */
  const voiceAnchor = nextTask ?? activeTasks[0] ?? null;

  const openVoiceForTask = useCallback((task: Task) => {
    flushSync(() => {
      setVoicePinnedTaskUuid(task.uuid);
      setVoiceSheetMode('TASK');
      setVoiceSheetOpen(true);
    });
    voiceSheetRef.current?.startRecordingFromUserGesture();
  }, []);

  const openTextForTask = useCallback(
    (task: Task) => {
      const label =
        [
          typeLabel(task.type),
          task.isGeneralTask ? strings.tasks.checklist.generalTaskLabel : task.propertyTitle,
          task.contextLabel,
        ]
          .filter(Boolean)
          .join(' · ') ||
        (task.isGeneralTask ? strings.tasks.checklist.generalTaskLabel : task.propertyTitle);
      setSupplementCtx({
        kind: 'task',
        id: task.uuid,
        label,
      });
    },
    [strings],
  );

  const handleVoiceSheetOpenChange = useCallback((open: boolean) => {
    setVoiceSheetOpen(open);
    if (!open) setVoicePinnedTaskUuid(null);
  }, []);

  const voiceTaskOptions = useMemo(
    () =>
      activeTasks.map((t) => ({
        uuid: t.uuid,
        label:
          [
            typeLabel(t.type),
            t.isGeneralTask ? strings.tasks.checklist.generalTaskLabel : t.propertyTitle,
            t.contextLabel,
          ]
            .filter(Boolean)
            .join(' · ') ||
          (t.isGeneralTask ? strings.tasks.checklist.generalTaskLabel : t.propertyTitle),
      })),
    [activeTasks, strings],
  );

  const [sessionShiftStartMs, setSessionShiftStartMs] = useState<number | null>(null);
  useEffect(() => {
    const raw = sessionStorage.getItem(`staffShiftStart_${todayStr}`);
    setSessionShiftStartMs(raw ? Number(raw) : null);
  }, [todayStr]);

  const incidentPropertyId = activeTasks[0]?.propertyId ?? null;

  const routeSorted = useMemo(() => {
    return [...activeTasks].sort((a, b) =>
      (a.streetAddress || a.propertyAddress).localeCompare(b.streetAddress || b.propertyAddress, 'ru'),
    );
  }, [activeTasks]);

  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();

  const handleMarkDoneTask = useCallback(
    (task: Task) => {
      enqueueMarkDoneAfterSwipe(task);
    },
    [enqueueMarkDoneAfterSwipe],
  );

  const handleMarkDone = (uuid: string) => {
    const t = activeTasks.find((x) => x.uuid === uuid);
    if (t) handleMarkDoneTask(t);
  };

  const shiftCompletedDurationLabel = formatShiftDurationLabel(
    todayTasks,
    user.staffShiftCompletedAt ?? null,
    sessionShiftStartMs,
  );

  const handleFinishShift = async () => {
    await completeShift();
  };

  const handleQuickStart = (uuid: string) => {
    updateStatus(
      { uuid, status: 'in_progress' },
      { onSuccess: () => setQuickTask(null) },
    );
  };

  const handleQuickIssue = (uuid: string) => {
    setQuickTask(null);
    const t = resolveTaskByUuid(uuid);
    if (t) setIssueTask(t);
  };

  const handleStartNextCard = () => {
    if (!nextTask || nextTask.status !== 'pending') return;
    updateStatus({ uuid: nextTask.uuid, status: 'in_progress' });
  };

  const shiftAlreadyDoneToday = isShiftDoneToday(user.staffShiftCompletedAt ?? null);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="staff-glass-header sticky top-0 z-20 border-b border-slate-200/80 shadow-sm shadow-slate-900/5">
        <div className="mx-auto flex w-full max-w-lg items-center justify-between px-4 py-3.5">
          <button
            type="button"
            className="flex min-w-0 items-center gap-3 text-left"
            onClick={() => setProfileOpen(true)}
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-teal-700 text-sm font-bold text-white shadow-md shadow-teal-600/25">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {user.firstName} {user.lastName}
              </p>
              <p className="flex items-center gap-1 text-xs text-slate-500">
                <Sparkles className="h-3 w-3 shrink-0 text-teal-600" aria-hidden />
                RentAI Staff
              </p>
            </div>
          </button>
          <div className="flex shrink-0 items-center gap-2">
            <StaffHistoryFab onClick={() => setHistoryOpen(true)} />
            <span
              className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs ${
                online ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'
              }`}
              title={online ? 'Онлайн' : 'Офлайн'}
            >
              {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            </span>
            <Button variant="outline" size="sm" onClick={onLogout} aria-label="Выйти" className="rounded-xl">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-8 pt-5">
        <section className="staff-card mb-4 overflow-hidden p-5 sm:p-6">
          <p className="text-xs font-medium uppercase tracking-wide text-teal-700">Сегодня</p>
          <h1 className="mt-1 text-2xl font-bold capitalize tracking-tight text-slate-900">{dateLabel}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">
            <CalendarDays className="h-4 w-4 text-teal-600" aria-hidden />
            Задачи на смену
          </p>
          {shiftEst && (
            <p className="mt-2 text-sm text-slate-600">
              Ориентир окончания:{' '}
              <span className="font-semibold text-teal-800">
                ~{format(shiftEst.end, 'HH:mm')}
              </span>{' '}
              (~45 мин × оставшихся задач)
            </p>
          )}
          <ProgressBar done={doneCount} total={total} />
        </section>

        <div className="mb-4 flex gap-2">
          <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setRouteOpen(true)}>
            <Route className="mr-2 h-4 w-4" />
            Маршрут
          </Button>
        </div>

        {isLoading && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-20 w-full rounded-2xl" />
            <Skeleton className="h-20 w-full rounded-2xl" />
            <Skeleton className="h-20 w-full rounded-2xl" />
          </div>
        )}

        {isError && (
          <div className="staff-card border-rose-100 bg-rose-50/90 p-4 text-sm text-rose-900/90">
            Не удалось загрузить задачи.{' '}
            <button
              type="button"
              className="font-semibold text-teal-800 underline underline-offset-2"
              onClick={() => void refetch()}
            >
              Повторить
            </button>
          </div>
        )}

        {!isLoading && !isError && activeTasks.length === 0 && (
          <div className="staff-card flex flex-col items-center px-6 py-12 text-center">
            <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-slate-100 to-slate-50 ring-1 ring-slate-200/80">
              <ClipboardList className="h-10 w-10 text-teal-600" strokeWidth={1.5} aria-hidden />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Нет активных задач</h2>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-slate-600">
              Назначенные вам задачи (на любую дату) появятся здесь. Проверьте, что в кабинете менеджера у задачи
              выбраны вы как исполнитель.
            </p>
          </div>
        )}

        {shiftAlreadyDoneToday && (
          <div className="mb-4 rounded-2xl border-2 border-teal-500/70 bg-gradient-to-br from-teal-50 via-white to-emerald-50/80 p-5 shadow-md shadow-teal-900/5">
            <p className="text-xl font-bold text-slate-900">🎉 Смена завершена!</p>
            <p className="mt-3 text-sm text-slate-700">
              Выполнено задач:{' '}
              <span className="font-semibold text-teal-900">
                {doneCount} / {total || '—'}
              </span>
            </p>
            <p className="mt-1 text-sm text-slate-700">
              С фото-верификацией:{' '}
              <span className="font-semibold text-teal-900">{verifiedCount}</span>
            </p>
            <p className="mt-1 text-sm text-slate-700">
              Время смены: <span className="font-semibold text-slate-900">{shiftCompletedDurationLabel}</span>
            </p>
          </div>
        )}

        {!isLoading && !isError && allDone && !shiftAlreadyDoneToday && (
          <div className="mb-4 space-y-3">
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-200/80 bg-gradient-to-r from-emerald-50 to-teal-50 px-4 py-3 text-emerald-900 shadow-sm">
              <PartyPopper className="h-8 w-8 shrink-0 text-emerald-600" aria-hidden />
              <div className="text-left">
                <p className="text-sm font-semibold">Все задачи выполнены</p>
                <p className="text-xs text-emerald-800/90">Можно завершить смену.</p>
              </div>
            </div>
            <Button
              className="w-full rounded-xl"
              size="lg"
              disabled={shiftPending}
              onClick={() => void handleFinishShift()}
            >
              Завершить смену
            </Button>
          </div>
        )}

        {!isLoading && !isError && activeTasks.length > 0 && nextTask && !allDone && (
          <div className="mb-4 rounded-2xl border-2 border-teal-500 bg-gradient-to-br from-teal-50/90 to-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-teal-800">Следующая задача</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {typeLabel(nextTask.type)} ·{' '}
              {nextTask.isGeneralTask ? strings.tasks.checklist.generalTaskLabel : nextTask.propertyTitle}
            </p>
            {nextTask.contextLabel ? (
              <p className="mt-1 text-sm text-slate-700">{nextTask.contextLabel}</p>
            ) : null}
            {nextTask.dueTime ? (
              <p className="mt-2 text-sm font-medium text-teal-900">До {nextTask.dueTime}</p>
            ) : (
              <p className="mt-2 text-sm text-slate-500">Без времени дедлайна</p>
            )}
            {nextTask.status === 'pending' && (
              <Button className="mt-4 w-full rounded-xl gap-2" onClick={handleStartNextCard}>
                <Play className="h-4 w-4" />
                Начать
              </Button>
            )}
            {nextTask.status === 'in_progress' && (
              <p className="mt-3 text-sm font-medium text-teal-800">В работе — откройте строку в списке для действий</p>
            )}
          </div>
        )}

        {!isLoading && !isError && activeTasks.length > 0 && (
          <div className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 px-0.5 text-sm font-semibold text-slate-700">
              <ClipboardList className="h-4 w-4 text-slate-400" aria-hidden />
              Список ({activeTasks.length})
            </h2>
            {activeTasks.map((task) => (
              <ChecklistItem
                key={task.uuid}
                task={task}
                dueDayHint={
                  task.dueDate !== todayStr
                    ? format(parseISO(`${task.dueDate}T12:00:00`), 'd MMMM', { locale: ru })
                    : undefined
                }
                deadlineUrgency={deadlineUrgency(task)}
                onMarkDone={handleMarkDone}
                onQuickOpen={setQuickTask}
                onVoiceForTask={openVoiceForTask}
                onTextForTask={openTextForTask}
              />
            ))}
          </div>
        )}

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

        <StaffHistoryDrawer
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          tasks={data?.tasks ?? []}
          onRequestTaskPhoto={(uuid) => {
            setHistoryOpen(false);
            setPhotoSupplement(true);
            setPhotoTaskUuid(uuid);
          }}
          onRequestIncidentPhoto={(uuid) => {
            setHistoryOpen(false);
            setIncidentPhotoUuid(uuid);
          }}
          onRequestSupplement={(ctx) => {
            setHistoryOpen(false);
            setSupplementCtx(ctx);
          }}
        />

        <StaffHistorySupplementSheet
          open={!!supplementCtx}
          context={supplementCtx}
          onOpenChange={(o) => {
            if (!o) setSupplementCtx(null);
          }}
        />

        <PhotoVerificationDrawer
          taskUuid={photoTaskUuid}
          open={!!photoTaskUuid}
          variant={photoSupplement ? 'supplement' : 'default'}
          onOpenChange={(o) => {
            if (!o) {
              setPhotoTaskUuid(null);
              setPhotoSupplement(false);
            }
          }}
        />

        <StaffIncidentPhotoAppendDrawer
          incidentUuid={incidentPhotoUuid ?? ''}
          open={!!incidentPhotoUuid}
          onOpenChange={(o) => {
            if (!o) setIncidentPhotoUuid(null);
          }}
        />

        <Drawer open={profileOpen} onOpenChange={setProfileOpen}>
          <DrawerContent title="Профиль">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-teal-700 text-lg font-bold text-white">
                {initials}
              </div>
              <div>
                <p className="font-semibold text-slate-900">
                  {user.firstName} {user.lastName}
                </p>
                <p className="text-sm text-slate-500">{user.email}</p>
              </div>
            </div>
            <div className="mt-4 rounded-xl bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase text-slate-500">Сегодня</p>
              <p className="mt-1 text-sm text-slate-800">
                Выполнено: {doneCount} / {total || '—'}
              </p>
              <p className="mt-1 text-sm text-slate-800">
                С фото (вериф.): {verifiedCount} / {doneCount || '—'}
              </p>
              {total > 0 && (
                <p className="mt-1 text-sm text-slate-800">
                  {Math.round((verifiedCount / Math.max(doneCount, 1)) * 100)}% готово с фото
                </p>
              )}
            </div>
            <Button variant="outline" className="mt-6 w-full" onClick={onLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Выйти
            </Button>
          </DrawerContent>
        </Drawer>

        <Drawer open={routeOpen} onOpenChange={setRouteOpen}>
          <DrawerContent title="Маршрут">
            <div className="px-1 pb-2">
              <StaffDeliveryRoutePanel tasksForFallback={routeSorted} />
            </div>
          </DrawerContent>
        </Drawer>

      </main>

      <IssueDrawer task={issueTask} open={!!issueTask} onOpenChange={(o) => !o && setIssueTask(null)} />

      {activeTasks.length > 0 && incidentPropertyId && (
        <>
          {/* Ручной текстовый инцидент — слева (голосовые кнопки справа) */}
          <button
            type="button"
            className="fixed bottom-14 left-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500 text-white shadow-lg shadow-amber-900/20 transition-transform active:scale-95"
            onClick={() => setIncidentOpen(true)}
            aria-label={strings.tasks.incident.fabLabel}
          >
            <AlertTriangle className="h-7 w-7" aria-hidden />
          </button>
          {/* Матрёшка: инцидент меньше, задача больше — открывают один sheet с разным prior */}
          <div className="fixed bottom-14 right-4 z-30 flex items-end gap-2">
            <button
              type="button"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-amber-400/80 bg-white text-amber-700 shadow-md shadow-amber-900/10 transition-transform active:scale-95"
              aria-label="Голосовой отчёт: инцидент"
              onClick={() => {
                flushSync(() => {
                  setVoicePinnedTaskUuid(null);
                  setVoiceSheetMode('INCIDENT');
                  setVoiceSheetOpen(true);
                });
                voiceSheetRef.current?.startRecordingFromUserGesture();
              }}
            >
              <AlertTriangle className="h-5 w-5" aria-hidden />
            </button>
            <button
              type="button"
              className="flex h-[4.2rem] w-[4.2rem] shrink-0 items-center justify-center rounded-full bg-teal-600 text-white shadow-lg shadow-teal-900/25 transition-transform active:scale-95"
              aria-label="Голосовой отчёт: задача"
              onClick={() => {
                flushSync(() => {
                  setVoicePinnedTaskUuid(null);
                  setVoiceSheetMode('TASK');
                  setVoiceSheetOpen(true);
                });
                voiceSheetRef.current?.startRecordingFromUserGesture();
              }}
            >
              <Mic className="h-[1.75rem] w-[1.75rem]" strokeWidth={2.25} aria-hidden />
            </button>
          </div>
          <StaffVoiceReportSheet
            ref={voiceSheetRef}
            open={voiceSheetOpen}
            onOpenChange={handleVoiceSheetOpenChange}
            initialMode={voiceSheetMode}
            taskOptions={voiceTaskOptions}
            defaultTaskUuid={voicePinnedTaskUuid ?? voiceAnchor?.uuid ?? ''}
          />
          <IncidentReportDrawer
            open={incidentOpen}
            onOpenChange={setIncidentOpen}
            propertyId={incidentPropertyId}
            taskId={null}
          />
        </>
      )}

      <div className="pb-safe" />
    </div>
  );
}

function typeLabel(type: string): string {
  const m: Record<string, string> = {
    checkout_cleaning: 'Уборка (выезд)',
    checkin_prep: 'Подготовка к заезду',
    mid_stay_cleaning: 'Плановая уборка',
    manual: 'Задача',
  };
  return m[type] ?? type;
}
