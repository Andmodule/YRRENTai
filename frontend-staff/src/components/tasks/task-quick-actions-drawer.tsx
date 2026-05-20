'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Play,
  CheckCircle2,
  AlertCircle,
  MessageSquareText,
  MapPin,
  ClipboardList,
  RotateCcw,
} from 'lucide-react';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import type { Task } from '@/hooks/use-tasks';
import { useStaffStrings } from '@/locales/staff-strings';
import { cn } from '@/lib/utils';
import { isVideoAttachmentUrl } from '@/lib/media-url';
import { StaffMediaViewerDrawer } from '@/components/tasks/staff-media-viewer-drawer';

const typeLabels: Record<string, string> = {
  checkout_cleaning: 'Уборка (выезд)',
  checkin_prep: 'Подготовка к заезду',
  mid_stay_cleaning: 'Плановая уборка',
  manual: 'Задача',
  other: 'Прочее',
};

interface TaskQuickActionsDrawerProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (uuid: string) => void;
  onMarkDone: (task: Task) => void;
  /** Вернуть из «готово» в открытые (водитель) */
  onMarkReopen?: (task: Task) => void;
  onMarkIssue: (uuid: string) => void;
  onOpenDetails: (task: Task) => void;
  startPending?: boolean;
  /** Скрыть кнопки Начать/Готово/Инцидент (например, для водителя) */
  readOnlyActions?: boolean;
  /** Подпись на завершение задачи (по умолчанию «Готово»). */
  markDoneLabel?: string;
}

export function TaskQuickActionsDrawer({
  task,
  open,
  onOpenChange,
  onStart,
  onMarkDone,
  onMarkReopen,
  onMarkIssue,
  onOpenDetails,
  startPending = false,
  readOnlyActions = false,
  markDoneLabel,
}: TaskQuickActionsDrawerProps) {
  const strings = useStaffStrings();
  const h = strings.tasks.history;
  const ti = strings.tasks.taskIssue;
  const tr = strings.driver.route;
  const generalLabel = strings.tasks.checklist.generalTaskLabel;
  const [mediaViewerOpen, setMediaViewerOpen] = useState(false);
  const [mediaViewerUrl, setMediaViewerUrl] = useState<string | null>(null);

  const existingMediaUrls = useMemo(
    () => (task ? ([...new Set((task.photoUrls ?? []).filter(Boolean))] as string[]) : []),
    [task],
  );

  useEffect(() => {
    setMediaViewerOpen(false);
    setMediaViewerUrl(null);
  }, [task?.uuid ?? '']);

  if (!task) return null;

  const isDone = task.status === 'done';
  const isIssue = task.status === 'issue';
  const isPending = task.status === 'pending';
  const canComplete = !isDone && !isIssue;

  const showMediaBlock = existingMediaUrls.length > 0;

  const isGeneral = task.isGeneralTask === true;
  const isIncidentType = task.type === 'incident' || task.type === 'damage' || task.type === 'lost_item';
  const isMaintenance = task.type === 'maintenance';

  const placeLabel = isGeneral ? generalLabel : task.propertyTitle;
  const generalTitle = isGeneral ? (task.title?.trim() || '') : '';
  const summary = task.checklistSummary;

  const cardClass = isIssue
    ? 'border-amber-300/90 bg-amber-50/90 dark:border-amber-500/50 dark:bg-amber-950/40'
    : isIncidentType
      ? 'border-rose-300/90 bg-rose-50/90 dark:border-rose-500/50 dark:bg-rose-950/40'
      : isMaintenance
        ? 'border-blue-300/90 bg-blue-50/90 dark:border-blue-500/50 dark:bg-blue-950/40'
        : isGeneral
          ? 'border-slate-300/90 bg-slate-50/90 dark:border-slate-600/80 dark:bg-slate-800/60'
          : 'border-slate-200/90 bg-slate-50/60 dark:border-slate-700/80 dark:bg-slate-900';

  return (
    <>
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={readOnlyActions ? 'Детали задачи' : 'Действия по задаче'} className="max-h-[min(92svh,900px)]">
        <div className="space-y-4 pb-10">
          <div className={cn('space-y-3 rounded-2xl border p-4 shadow-sm shadow-slate-900/5 dark:shadow-black/20', cardClass)}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {typeLabels[task.type] ?? task.type}
            </p>
            <p className="text-xl font-normal leading-snug text-slate-900 dark:text-slate-50">{placeLabel}</p>
            {generalTitle ? (
              <p className="text-sm font-normal leading-snug text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">
                {generalTitle}
              </p>
            ) : null}
            {!isGeneral &&
            task.title?.trim() &&
            task.title.trim() !== (task.propertyTitle ?? '').trim() ? (
              <p className="text-sm font-normal leading-snug text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words">
                {task.title.trim()}
              </p>
            ) : null}
            {!isGeneral && (task.streetAddress || task.propertyAddress) ? (
              <p className="flex gap-2 text-sm text-slate-600 dark:text-slate-300">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
                <span>{task.streetAddress || task.propertyAddress}</span>
              </p>
            ) : null}
            {task.contextLabel ? (
              <p className="rounded-xl border border-teal-100 bg-teal-50/90 px-3 py-2 text-sm text-teal-900 dark:border-teal-800/80 dark:bg-teal-950/60 dark:text-teal-100">
                {task.contextLabel}
              </p>
            ) : null}
            {task.dueTime ? (
              <p className="text-sm text-slate-600 dark:text-slate-300">До {task.dueTime}</p>
            ) : null}
            {summary && summary.total > 0 ? (
              <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-200">
                <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden />
                <span>
                  Чеклист: {summary.checked} из {summary.total}
                  {summary.requiredUnchecked > 0
                    ? ` · обязательных не сделано: ${summary.requiredUnchecked}`
                    : ''}
                </span>
              </div>
            ) : null}
            {showMediaBlock ? (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {h.detailAttachments}
                </p>
                <div className="flex flex-wrap items-start gap-2">
                  {existingMediaUrls.map((url) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => {
                        setMediaViewerUrl(url);
                        setMediaViewerOpen(true);
                      }}
                      className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-slate-200/90 bg-slate-100 ring-offset-2 transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:border-slate-600 dark:bg-slate-800"
                    >
                      {isVideoAttachmentUrl(url) ? (
                        <video
                          src={url}
                          muted
                          playsInline
                          className="h-full w-full object-cover"
                          preload="metadata"
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- staff attachment URL
                        <img src={url} alt="" className="h-full w-full object-cover" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {readOnlyActions && isDone && onMarkReopen ? (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-12 w-full justify-center gap-2 rounded-xl text-base border-teal-200 text-teal-900 hover:bg-teal-50 dark:border-teal-800 dark:text-teal-100 dark:hover:bg-teal-950/50"
                onClick={() => onMarkReopen(task)}
              >
                <RotateCcw className="h-5 w-5" />
                {tr.propertyTasksReopen}
              </Button>
              <Button
                type="button"
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
          ) : null}

          {!readOnlyActions && (
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
                  {markDoneLabel ?? 'Готово'}
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
          )}
        </div>
      </DrawerContent>
    </Drawer>
    <StaffMediaViewerDrawer
      open={mediaViewerOpen}
      onOpenChange={(o) => {
        setMediaViewerOpen(o);
        if (!o) {
          setMediaViewerUrl(null);
        }
      }}
      title={h.detailAttachments}
      urls={mediaViewerUrl ? [mediaViewerUrl] : []}
    />
    </>
  );
}
