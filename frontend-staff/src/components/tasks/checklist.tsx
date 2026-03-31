'use client';

import { useMemo, useState, useEffect } from 'react';
import { format, startOfDay } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  CalendarDays,
  ClipboardList,
  LogOut,
  PartyPopper,
  Sparkles,
  MapPin,
  Wifi,
  WifiOff,
  Route,
} from 'lucide-react';
import { useTodayTasks } from '@/hooks/use-tasks';
import { useTasksSocket } from '@/hooks/use-tasks-socket';
import type { Task } from '@/hooks/use-tasks';
import type { StaffUser } from '@/hooks/use-auth';
import { useUpdateTaskStatus, useCompleteShift } from '@/hooks/use-tasks';
import { ChecklistItem } from './checklist-item';
import { ProgressBar } from './progress-bar';
import { IssueDrawer } from './issue-drawer';
import { PhotoVerificationDrawer } from './photo-verification-drawer';
import { TaskDetailStaff } from './task-detail-staff';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { deadlineUrgency, estimateShiftEnd, isShiftDoneToday } from '@/lib/shift-utils';

interface StaffChecklistProps {
  user: StaffUser;
  onLogout: () => void;
}

export function StaffChecklist({ user, onLogout }: StaffChecklistProps) {
  useTasksSocket();

  const today = useMemo(() => startOfDay(new Date()), []);
  const todayStr = format(today, 'yyyy-MM-dd');
  const dateLabel = format(today, 'EEEE, d MMMM', { locale: ru });

  const { data, isLoading, isError, refetch } = useTodayTasks();
  const { mutate: updateStatus } = useUpdateTaskStatus();
  const { mutateAsync: completeShift, isPending: shiftPending } = useCompleteShift();

  const [issueUuid, setIssueUuid] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [photoTaskUuid, setPhotoTaskUuid] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [shiftCompleteView, setShiftCompleteView] = useState(false);
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

  const doneCount = todayTasks.filter((t) => t.status === 'done').length;
  const verifiedCount = todayTasks.filter((t) => t.status === 'done' && t.hasVerificationPhoto).length;
  const total = todayTasks.length;
  const allDone = total > 0 && doneCount === total;
  const shiftEst = estimateShiftEnd(todayTasks);

  const nextTask = useMemo(() => {
    const pending = todayTasks.filter((t) => t.status !== 'done' && t.status !== 'issue');
    return pending[0] ?? null;
  }, [todayTasks]);

  const routeSorted = useMemo(() => {
    return [...todayTasks].sort((a, b) =>
      (a.streetAddress || a.propertyAddress).localeCompare(b.streetAddress || b.propertyAddress, 'ru'),
    );
  }, [todayTasks]);

  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();

  const handleMarkDone = (uuid: string) => {
    updateStatus(
      { uuid, status: 'done' },
      {
        onSuccess: () => setPhotoTaskUuid(uuid),
      },
    );
  };

  const shiftDurationLabel = () => {
    if (typeof sessionStorage === 'undefined') return '—';
    const key = `staffShiftStart_${todayStr}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return '—';
    const mins = Math.round((Date.now() - Number(raw)) / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}ч ${m}мин` : `${m}мин`;
  };

  const handleFinishShift = async () => {
    await completeShift();
    setShiftCompleteView(true);
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
          {nextTask && (
            <div className="mt-4 rounded-2xl border border-teal-200/80 bg-gradient-to-br from-teal-50 to-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">Сейчас дальше</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{nextTask.propertyTitle}</p>
              <p className="text-xs text-slate-600">
                {nextTask.contextLabel ?? typeLabel(nextTask.type)}
                {nextTask.dueTime ? ` · до ${nextTask.dueTime}` : ''}
              </p>
            </div>
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

        {!isLoading && !isError && total === 0 && (
          <div className="staff-card flex flex-col items-center px-6 py-12 text-center">
            <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-slate-100 to-slate-50 ring-1 ring-slate-200/80">
              <ClipboardList className="h-10 w-10 text-teal-600" strokeWidth={1.5} aria-hidden />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Нет задач на сегодня</h2>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-slate-600">
              Когда менеджер назначит вам объекты, задачи появятся здесь.
            </p>
          </div>
        )}

        {!isLoading && !isError && allDone && !shiftCompleteView && (
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
              disabled={shiftPending || shiftAlreadyDoneToday}
              onClick={() => void handleFinishShift()}
            >
              {shiftAlreadyDoneToday ? 'Смена уже отмечена' : 'Завершить смену'}
            </Button>
          </div>
        )}

        {!isLoading && !isError && total > 0 && (
          <div className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 px-0.5 text-sm font-semibold text-slate-700">
              <ClipboardList className="h-4 w-4 text-slate-400" aria-hidden />
              Список ({total})
            </h2>
            {todayTasks.map((task) => (
              <ChecklistItem
                key={task.uuid}
                task={task}
                deadlineUrgency={deadlineUrgency(task)}
                onMarkDone={handleMarkDone}
                onMarkIssue={(uuid) => setIssueUuid(uuid)}
                onOpen={setDetailTask}
              />
            ))}
          </div>
        )}

        <TaskDetailStaff task={detailTask} open={!!detailTask} onClose={() => setDetailTask(null)} />

        <PhotoVerificationDrawer
          taskUuid={photoTaskUuid}
          open={!!photoTaskUuid}
          onOpenChange={(o) => {
            if (!o) setPhotoTaskUuid(null);
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
          <DrawerContent title="Маршрут по адресам">
            <p className="mb-3 text-sm text-slate-600">Откройте объект в картах по порядку адреса.</p>
            <ul className="space-y-2">
              {routeSorted.map((t) => {
                const addr = encodeURIComponent(t.streetAddress || t.propertyAddress);
                return (
                  <li key={t.uuid}>
                    <a
                      href={`https://maps.google.com/?q=${addr}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm text-teal-800 hover:bg-teal-50"
                    >
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{t.streetAddress || t.propertyAddress}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </DrawerContent>
        </Drawer>

        {shiftCompleteView && (
          <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-gradient-to-b from-teal-50 to-white p-6 text-center">
            <PartyPopper className="mb-4 h-16 w-16 text-teal-600" />
            <h2 className="text-2xl font-bold text-slate-900">Смена завершена</h2>
            <p className="mt-2 text-slate-600">
              Выполнено задач: {doneCount}/{total}
            </p>
            <p className="mt-1 text-slate-600">Фото к задачам: {verifiedCount} из {doneCount || total}</p>
            <p className="mt-1 text-slate-600">Время на смене: ~{shiftDurationLabel()}</p>
            <Button className="mt-8" onClick={() => setShiftCompleteView(false)}>
              Закрыть
            </Button>
          </div>
        )}
      </main>

      <IssueDrawer taskUuid={issueUuid} open={!!issueUuid} onOpenChange={(o) => !o && setIssueUuid(null)} />

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
