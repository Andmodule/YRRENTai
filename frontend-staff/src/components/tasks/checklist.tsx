'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import { format, startOfDay, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  CalendarDays,
  ClipboardList,
  LogOut,
  Sparkles,
  Wifi,
  WifiOff,
  AlertTriangle,
  Mic,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTodayTasks } from '@/hooks/use-tasks';
import { useTasksSocket } from '@/hooks/use-tasks-socket';
import type { Task } from '@/hooks/use-tasks';
import type { StaffUser } from '@/hooks/use-auth';
import { useUpdateTaskStatus } from '@/hooks/use-tasks';
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
import { StaffHistoryDrawer, StaffHistoryFab } from './staff-history-drawer';
import {
  StaffHistorySupplementSheet,
  type StaffSupplementContext,
} from './staff-history-supplement-sheet';
import { useStaffStrings } from '@/locales/staff-strings';
import { apiClient } from '@/lib/api/client';
import {
  parseTaskUuidFromTelegramStartParam,
  readTelegramWebAppStartParam,
  STAFF_TASK_DETAIL_QUERY,
} from '@/lib/telegram-start-param';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { deadlineUrgency, estimateShiftEnd, pickNextTaskByDueTime } from '@/lib/shift-utils';
import { isTaskCompletedToday } from '@/lib/staff-history-date';

/**
 * Нижние круглые накладные кнопки (инцидент слева + два голосовых справа) скрыты в интерфейсе уборщицы.
 * Код кнопок оставлен: при необходимости удалить полностью — отдельной командой (вместе с этим флагом).
 */
const HIDE_CLEANER_BOTTOM_OVERLAY_FABS = true;

interface StaffChecklistProps {
  user: StaffUser;
  onLogout: () => void;
}

export function StaffChecklist({ user, onLogout }: StaffChecklistProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskQuery = searchParams.get(STAFF_TASK_DETAIL_QUERY);
  useTasksSocket(user.id);
  const strings = useStaffStrings();

  const today = useMemo(() => startOfDay(new Date()), []);
  const todayStr = format(today, 'yyyy-MM-dd');
  const dateLabel = format(today, 'EEEE, d MMMM', { locale: ru });

  const { data, isLoading, isError, refetch } = useTodayTasks();
  const { mutate: updateStatus, isPending: statusPending } = useUpdateTaskStatus();

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

  const [issueTask, setIssueTask] = useState<Task | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [quickTask, setQuickTask] = useState<Task | null>(null);
  const [photoTaskUuid, setPhotoTaskUuid] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [supplementCtx, setSupplementCtx] = useState<StaffSupplementContext | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
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

  /** Все назначенные задачи из API (широкий диапазон дат) — для поиска и открытого списка. */
  const allAssigned = useMemo(() => data?.tasks ?? [], [data?.tasks]);

  /** Задачи с `dueDate` = сегодня: прогресс и «все сделаны» по смене. */
  const todayScopeTasks = useMemo(
    () => allAssigned.filter((t) => t.dueDate === todayStr),
    [allAssigned, todayStr],
  );

  /** Как в TMA: невыполненные задачи на любую дату из ответа API (широкий диапазон дат). */
  const activeTasks = useMemo(() => {
    const list = (data?.tasks ?? []).filter((t) => t.status !== 'done');
    const pr: Record<string, number> = { urgent: 0, normal: 1 };
    return [...list].sort((a, b) => {
      const dd = a.dueDate.localeCompare(b.dueDate);
      if (dd !== 0) return dd;
      const pa = pr[a.priority] ?? 1;
      const pb = pr[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      return (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99');
    });
  }, [data?.tasks]);

  /**
   * Невыполненные (любой due) + завершённые **сегодня** (по `completedAt`, не по дедлайну).
   * Старые `done` не показываем в списке смены — их можно открыть в «Истории».
   */
  const orderedAllTasks = useMemo(() => {
    const pr: Record<string, number> = { urgent: 0, normal: 1 };
    const list = allAssigned.filter(
      (t) => t.status !== 'done' || isTaskCompletedToday(t),
    );
    return [...list].sort((a, b) => {
      const dd = a.dueDate.localeCompare(b.dueDate);
      if (dd !== 0) return dd;
      const pa = pr[a.priority] ?? 1;
      const pb = pr[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      return (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99');
    });
  }, [allAssigned]);

  const resolveTaskByUuid = useCallback(
    (uuid: string) => activeTasks.find((t) => t.uuid === uuid) ?? allAssigned.find((t) => t.uuid === uuid) ?? null,
    [activeTasks, allAssigned],
  );

  /** Telegram `startapp=task_…` → тот же deep link, что в legacy TMA (frontend-user). */
  const tgTaskSyncedRef = useRef(false);
  useEffect(() => {
    if (tgTaskSyncedRef.current) return;
    const fromTg = parseTaskUuidFromTelegramStartParam(readTelegramWebAppStartParam());
    if (!fromTg) return;
    tgTaskSyncedRef.current = true;
    if (taskQuery === fromTg) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set(STAFF_TASK_DETAIL_QUERY, fromTg);
    router.replace(`/tasks?${params.toString()}`);
  }, [router, searchParams, taskQuery]);

  useEffect(() => {
    if (!taskQuery) {
      return;
    }
    const local = resolveTaskByUuid(taskQuery);
    if (local) {
      setDetailTask((prev) => (prev?.uuid === local.uuid ? prev : local));
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiClient.get<{ data: { task: Task } }>(`/tasks/${taskQuery}`);
        if (cancelled) return;
        const t = res.data.data.task;
        setDetailTask((prev) => (prev?.uuid === t.uuid ? prev : t));
      } catch {
        if (cancelled) return;
        const params = new URLSearchParams(searchParams.toString());
        params.delete(STAFF_TASK_DETAIL_QUERY);
        const q = params.toString();
        router.replace(q ? `/tasks?${q}` : '/tasks');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskQuery, resolveTaskByUuid, searchParams, router]);

  const closeTaskDetail = useCallback(() => {
    if (searchParams.get(STAFF_TASK_DETAIL_QUERY)) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete(STAFF_TASK_DETAIL_QUERY);
      const q = params.toString();
      router.replace(q ? `/tasks?${q}` : '/tasks');
    }
    setDetailTask(null);
  }, [router, searchParams]);

  const doneCount = todayScopeTasks.filter((t) => t.status === 'done').length;
  const verifiedCount = todayScopeTasks.filter((t) => t.status === 'done' && t.hasVerificationPhoto).length;
  const total = todayScopeTasks.length;
  const allDone = total > 0 && doneCount === total;
  const shiftEst = estimateShiftEnd(todayScopeTasks);

  /** Контекст голосового отчёта с FAB: следующая по времени или первая в списке. */
  const voiceAnchor = useMemo(
    () => pickNextTaskByDueTime(activeTasks) ?? activeTasks[0] ?? null,
    [activeTasks],
  );

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

  const incidentPropertyId = activeTasks[0]?.propertyId ?? null;

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

  const handleMarkReopen = useCallback(
    (uuid: string) => {
      cancelPendingForUuid(uuid);
      const t = allAssigned.find((x) => x.uuid === uuid);
      if (t?.status === 'done') {
        updateStatus({ uuid, status: 'pending' });
      }
    },
    [allAssigned, cancelPendingForUuid, updateStatus],
  );

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

        {!isLoading && !isError && allAssigned.length === 0 && (
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

        {!isLoading && !isError && allDone && total > 0 && (
          <div className="mb-4 rounded-2xl border border-teal-200/80 bg-teal-50/80 px-4 py-3 text-sm text-teal-900">
            <p className="font-semibold">{strings.tasks.checklist.allTasksDoneTitle}</p>
            <p className="mt-1 text-teal-800/95">{strings.tasks.checklist.allTasksDoneHint}</p>
          </div>
        )}

        {!isLoading && !isError && orderedAllTasks.length > 0 && (
          <div className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 px-0.5 text-sm font-semibold text-slate-700">
              <ClipboardList className="h-4 w-4 text-slate-400" aria-hidden />
              {strings.tasks.checklist.activeListHeading(orderedAllTasks.length)}
            </h2>
            {orderedAllTasks.map((task) => (
              <ChecklistItem
                key={task.uuid}
                task={task}
                dueDayHint={
                  task.dueDate !== todayStr
                    ? format(parseISO(`${task.dueDate}T12:00:00`), 'd MMMM', { locale: ru })
                    : undefined
                }
                deadlineUrgency={task.status === 'done' ? 'teal' : deadlineUrgency(task)}
                onMarkDone={handleMarkDone}
                onMarkReopen={handleMarkReopen}
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
          markDoneLabel={strings.tasks.checklist.quickActionMarkDone}
          onAddVerification={(t) => {
            setPhotoTaskUuid(t.uuid);
          }}
          onMarkIssue={handleQuickIssue}
          onOpenDetails={(t) => {
            const q = searchParams.get(STAFF_TASK_DETAIL_QUERY);
            if (q && q !== t.uuid) {
              router.replace('/tasks');
            }
            setDetailTask(t);
          }}
          startPending={statusPending}
        />

        <TaskDetailStaff
          task={detailTask}
          open={!!detailTask}
          onClose={closeTaskDetail}
          checklistScrollNonce={checklistScrollNonce}
        />

        <StaffHistoryDrawer open={historyOpen} onOpenChange={setHistoryOpen} tasks={data?.tasks ?? []} />

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
          variant="default"
          onOpenChange={(o) => {
            if (!o) {
              setPhotoTaskUuid(null);
            }
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
              <p className="text-xs font-semibold uppercase text-slate-500">
                {strings.tasks.checklist.profileTaskStatsLabel}
              </p>
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

      </main>

      <IssueDrawer task={issueTask} open={!!issueTask} onOpenChange={(o) => !o && setIssueTask(null)} />

      {activeTasks.length > 0 && incidentPropertyId && (
        <>
          {!HIDE_CLEANER_BOTTOM_OVERLAY_FABS ? (
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
            </>
          ) : null}
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
