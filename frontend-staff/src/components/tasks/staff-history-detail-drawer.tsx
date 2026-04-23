'use client';

import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import type { Task } from '@/hooks/use-tasks';
import type { StaffIncidentHistoryItem } from '@/hooks/use-tasks';
import { useStaffStrings, type StaffStrings } from '@/locales/staff-strings';
import { isVideoAttachmentUrl } from '@/lib/media-url';
import { stripStaffSeedTaskMarker } from '@rentai/shared';

function taskTypeLabel(type: string): string {
  const m: Record<string, string> = {
    checkout_cleaning: 'Уборка (выезд)',
    checkin_prep: 'Подготовка к заезду',
    mid_stay_cleaning: 'Плановая уборка',
    manual: 'Задача',
  };
  return m[type] ?? type;
}

function taskHeadline(t: Task): string {
  return [taskTypeLabel(t.type), t.propertyTitle, t.contextLabel].filter(Boolean).join(' · ');
}

function MediaSection({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="space-y-3">
      {urls.map((url) => (
        <div
          key={url}
          className="overflow-hidden rounded-2xl border border-slate-200/90 bg-slate-950/5 dark:border-slate-700 dark:bg-slate-900/40"
        >
          {isVideoAttachmentUrl(url) ? (
            <video
              src={url}
              controls
              playsInline
              className="max-h-[min(50vh,360px)] w-full object-contain bg-black"
              preload="metadata"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="max-h-[min(50vh,360px)] w-full object-contain" />
          )}
        </div>
      ))}
    </div>
  );
}

export type StaffHistoryDetailState =
  | { kind: 'task'; task: Task }
  | { kind: 'incident'; item: StaffIncidentHistoryItem }
  | null;

export function StaffHistoryDetailDrawer({
  detail,
  onOpenChange,
}: {
  detail: StaffHistoryDetailState;
  onOpenChange: (open: boolean) => void;
}) {
  const h = useStaffStrings().tasks.history;
  const open = detail !== null;

  const title =
    detail?.kind === 'task'
      ? taskHeadline(detail.task)
      : detail?.kind === 'incident'
        ? [h.typeLabels[detail.item.type] ?? detail.item.type, detail.item.propertyTitle].filter(Boolean).join(' · ')
        : '';

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={title} className="max-h-[min(88svh,720px)]">
        <div className="max-h-[min(70svh,560px)] space-y-4 overflow-y-auto pr-1 text-sm">
          {detail?.kind === 'task' ? (
            <TaskDetailBody task={detail.task} h={h} />
          ) : detail?.kind === 'incident' ? (
            <IncidentDetailBody item={detail.item} h={h} />
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function TaskDetailBody({
  task,
  h,
}: {
  task: Task;
  h: StaffStrings['tasks']['history'];
}) {
  const notes = stripStaffSeedTaskMarker(task.notes)?.trim();
  const urls = task.photoUrls ?? [];
  const street = task.streetAddress || task.propertyAddress;

  return (
    <>
      <dl className="space-y-2.5 text-slate-700 dark:text-slate-200">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {h.detailCompleted}
          </dt>
          <dd>
            {task.completedAt
              ? format(parseISO(task.completedAt), 'd MMMM yyyy, HH:mm', { locale: ru })
              : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {h.detailDue}
          </dt>
          <dd>
            {task.dueDate}
            {task.dueTime ? ` · ${task.dueTime}` : ''}
          </dd>
        </div>
        {street ? (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {h.detailAddress}
            </dt>
            <dd className="whitespace-pre-wrap break-words">{street}</dd>
          </div>
        ) : null}
        {notes ? (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {h.detailNotes}
            </dt>
            <dd className="whitespace-pre-wrap break-words">{notes}</dd>
          </div>
        ) : null}
      </dl>
      {urls.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {h.detailAttachments}
          </p>
          <MediaSection urls={urls} />
        </div>
      ) : null}
    </>
  );
}

function IncidentDetailBody({
  item,
  h,
}: {
  item: StaffIncidentHistoryItem;
  h: StaffStrings['tasks']['history'];
}) {
  const urls = item.photoUrls ?? [];
  return (
    <>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {h.detailDescription}
        </p>
        <p className="mt-1 whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">
          {item.descriptionPreview || '—'}
        </p>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {format(parseISO(item.createdAt), 'd MMMM yyyy, HH:mm', { locale: ru })}
      </p>
      {urls.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {h.detailAttachments}
          </p>
          <MediaSection urls={urls} />
        </div>
      ) : null}
    </>
  );
}
