'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Clock, MapPin } from 'lucide-react';
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalClose,
} from '@/components/ui/responsive-modal';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useUpdateTaskNotes, useTaskNotes, useMarkTaskSeen } from '../../hooks/useTasks';
import type { Task } from '../../types';
import { stripStaffSeedTaskMarker } from '@rentai/shared';
import { TaskStatusBadge } from './TaskStatusBadge';
import { TaskTypeBadge } from './TaskTypeBadge';

interface TaskDetailDrawerProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Staff view: read-only notes */
  isStaffView?: boolean;
}

export function TaskDetailDrawer({ task, open, onOpenChange, isStaffView }: TaskDetailDrawerProps) {
  const t = useTranslations('tasks.detail');
  const [notes, setNotes] = useState('');
  const { mutateAsync: saveNotes, isPending } = useUpdateTaskNotes();
  const { data: staffNotes } = useTaskNotes(task?.uuid ?? null, open && !!task && !isStaffView);
  const { mutate: markSeen } = useMarkTaskSeen();

  useEffect(() => {
    if (task && open) {
      setNotes(stripStaffSeedTaskMarker(task.notes));
    }
  }, [task, open]);

  useEffect(() => {
    if (open && task && !isStaffView) {
      markSeen(task.uuid);
    }
  }, [open, task?.uuid, isStaffView, markSeen]);

  if (!task) {
    return null;
  }

  const due =
    task.dueTime != null
      ? `${format(new Date(task.dueDate), 'd MMM yyyy', { locale: ru })} · ${task.dueTime}`
      : format(new Date(task.dueDate), 'd MMM yyyy', { locale: ru });

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent title={task.propertyTitle} description={task.propertyAddress}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatusBadge status={task.status} />
            <TaskTypeBadge type={task.type} />
            {(task.hasVerificationPhoto ?? false) && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                verified
              </span>
            )}
          </div>

          {task.contextLabel ? (
            <div className="rounded-lg border border-blue-200/80 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-500/35 dark:bg-blue-950/55 dark:text-blue-100">
              {task.contextLabel}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-4 w-4" />
              {due}
            </span>
            <span className="inline-flex items-start gap-1">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              {task.propertyAddress}
            </span>
          </div>

          {!isStaffView && (
            <div>
              <p className="text-sm font-medium text-foreground">{t('assignee')}</p>
              <p className="text-sm text-muted-foreground">{task.assigneeName ?? t('unassigned')}</p>
            </div>
          )}

          {!isStaffView && staffNotes && staffNotes.length > 0 && (
            <div className="rounded-lg border border-amber-200/90 bg-amber-50/95 p-3 dark:border-amber-800/55 dark:bg-amber-950/45">
              <p className="mb-2 text-sm font-medium text-amber-950 dark:text-amber-100">
                Заметки от персонала
              </p>
              <ul className="space-y-2 text-sm">
                {staffNotes.map((n) => (
                  <li key={n.uuid} className="border-b border-amber-200/70 pb-2 last:border-0 dark:border-amber-800/45">
                    <span className="text-xs text-amber-800/90 dark:text-amber-200/85">{n.authorName}</span>
                    <p className="text-amber-950 dark:text-amber-50">{n.text}</p>
                    {n.photoUrl && (
                      <a href={n.photoUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
                        Фото
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="task-notes">{t('notes')}</Label>
            <Textarea
              id="task-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              readOnly={isStaffView}
              onBlur={() => {
                if (!isStaffView && notes !== stripStaffSeedTaskMarker(task.notes)) {
                  void saveNotes({ uuid: task.uuid, notes });
                }
              }}
              disabled={isPending}
              rows={4}
            />
          </div>

          {task.photoUrls.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">{t('photos')}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {task.photoUrls.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative aspect-square overflow-hidden rounded-lg border bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- external URLs */}
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}

          <ResponsiveModalClose asChild>
            <Button type="button" variant="secondary" className="w-full sm:w-auto">
              {t('close')}
            </Button>
          </ResponsiveModalClose>
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
