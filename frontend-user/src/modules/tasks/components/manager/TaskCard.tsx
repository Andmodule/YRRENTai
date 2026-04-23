'use client';

import { memo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useTranslations } from 'next-intl';
import { Clock, User, MessageCircle, BadgeCheck, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Task } from '../../types';
import { isTaskOverdue } from '../../utils/task-deadline';
import { TaskTypeBadge } from '../shared/TaskTypeBadge';
import { TaskManagerLinkBadges } from './TaskManagerLinkBadges';

export const TaskCard = memo(function TaskCard({
  task,
  onOpen,
}: {
  task: Task;
  onOpen: (t: Task) => void;
}) {
  const t = useTranslations('tasks');
  const tKanban = useTranslations('tasks.kanban');
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.uuid,
    data: { task },
  });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 50 : undefined,
      }
    : undefined;

  const urgent = task.priority === 'urgent';
  const overdue = isTaskOverdue(task);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      className={cn(
        'rounded-xl border border-border bg-card p-3 text-card-foreground shadow-sm transition-shadow duration-200',
        'cursor-grab active:cursor-grabbing hover:shadow-md dark:shadow-none',
        isDragging && 'opacity-70 ring-2 ring-primary/30',
        overdue &&
          'border-l-[3px] border-l-amber-600/30 bg-amber-500/[0.06] dark:border-l-amber-500/40 dark:bg-amber-500/[0.07]',
      )}
      onClick={() => onOpen(task)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(task);
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <TaskTypeBadge type={task.type} />
          {(task.hasVerificationPhoto ?? false) && (
            <span title="Фото-верификация" className="inline-flex items-center gap-0.5 text-emerald-600">
              <BadgeCheck className="h-4 w-4" aria-hidden />
            </span>
          )}
          {(task.unseenNotesCount ?? 0) > 0 && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200"
              title="Новые заметки от персонала"
            >
              <MessageCircle className="h-3 w-3" aria-hidden />
              {task.unseenNotesCount}
            </span>
          )}
          {(task.pendingSupplyInterpretationIds?.length ?? 0) > 0 ||
          (task.linkedIncidentIdsFromTask?.length ?? 0) > 0 ||
          !!task.incidentId ? (
            <TaskManagerLinkBadges task={task} compact />
          ) : null}
        </div>
        <span className="flex items-center gap-1">
          {urgent && <span className="h-1 w-1 rounded-full bg-rose-500" title={t('priority.urgent')} />}
        </span>
      </div>
      <p className="mt-2 text-sm font-normal text-foreground">
        {task.title || task.propertyTitle}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{task.propertyTitle}</p>
      {task.contextLabel && (
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{task.contextLabel}</p>
      )}
      {task.dueTime && (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          {task.dueTime}
        </p>
      )}
      <div className="mt-2 flex items-center gap-1 text-xs text-amber-800 dark:text-amber-400/95">
        <User className="h-3.5 w-3.5 shrink-0" />
        <span>{task.assigneeName ?? t('unassigned')}</span>
      </div>
    </div>
  );
});
