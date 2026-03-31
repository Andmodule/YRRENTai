'use client';

import { memo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { Task } from '../../types';
import { TaskCard } from './TaskCard';
import type { KanbanColumnDef } from '../../constants';

export const KanbanColumn = memo(function KanbanColumn({
  column,
  tasks,
  onOpenTask,
}: {
  column: KanbanColumnDef;
  tasks: Task[];
  onOpenTask: (t: Task) => void;
}) {
  const t = useTranslations('tasks.columns');
  const tEmpty = useTranslations('tasks.emptyColumn');
  const { setNodeRef, isOver } = useDroppable({ id: column.status });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[min(70vh,560px)] w-[min(100%,280px)] shrink-0 flex-col rounded-xl border border-gray-100 bg-gray-50/80 p-2',
        isOver && 'ring-2 ring-primary/40',
      )}
      aria-label={t('columnAria', { title: t(column.headerKey), count: tasks.length })}
    >
      <div className={cn('mb-2 flex items-center justify-between px-1 text-sm font-semibold', column.headerClass)}>
        <span>{t(column.headerKey)}</span>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-600">{tasks.length}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 p-4 text-center text-xs text-gray-400">
            {tEmpty(column.emptyKey)}
          </div>
        ) : (
          tasks.map((task) => <TaskCard key={task.uuid} task={task} onOpen={onOpenTask} />)
        )}
      </div>
    </div>
  );
});
