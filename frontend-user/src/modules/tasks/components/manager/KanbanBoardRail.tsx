'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useMatchMedia } from '@/hooks/use-match-media';
import { cn } from '@/lib/utils';
import type { Task, TaskStatus } from '../../types';
import { KANBAN_COLUMNS } from '../../constants';
import { KanbanColumn } from './KanbanColumn';
import type { Incident } from '@/modules/incidents/hooks/useIncidents';

export function KanbanBoardRail({
  byStatus,
  boardIncidents,
  onOpenTask,
  onOpenIncident,
}: {
  byStatus: Record<TaskStatus, Task[]>;
  boardIncidents: Incident[];
  onOpenTask: (t: Task) => void;
  onOpenIncident: (i: Incident) => void;
}) {
  const t = useTranslations('tasks.columns');
  const tKanban = useTranslations('tasks.viewModes');
  const isMd = useMatchMedia('(min-width: 768px)');

  const boardRef = useRef<HTMLDivElement>(null);
  const columnRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [activeCol, setActiveCol] = useState(0);

  const scrollToColumn = useCallback((index: number) => {
    const el = columnRefs.current[index];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, []);

  const updateActiveFromScroll = useCallback(() => {
    const rail = boardRef.current;
    if (!rail) return;
    const mid = rail.scrollLeft + rail.clientWidth / 2;
    for (let i = 0; i < columnRefs.current.length; i++) {
      const col = columnRefs.current[i];
      if (!col) continue;
      const left = col.offsetLeft;
      const right = left + col.offsetWidth;
      if (mid >= left && mid < right) {
        setActiveCol(i);
        break;
      }
    }
  }, []);

  useEffect(() => {
    if (isMd) return;
    const rail = boardRef.current;
    if (!rail) return;
    const onScroll = () => {
      requestAnimationFrame(updateActiveFromScroll);
    };
    rail.addEventListener('scroll', onScroll, { passive: true });
    updateActiveFromScroll();
    return () => rail.removeEventListener('scroll', onScroll);
  }, [isMd, updateActiveFromScroll]);

  const columnCounts = KANBAN_COLUMNS.map((col) =>
    col.status === 'issue'
      ? byStatus.issue.length + boardIncidents.length
      : byStatus[col.status].length,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      {!isMd && (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {KANBAN_COLUMNS.map((col, i) => (
              <Button
                key={col.status}
                type="button"
                variant={activeCol === i ? 'secondary' : 'outline'}
                size="sm"
                className="shrink-0 rounded-full px-3 font-normal"
                onClick={() => scrollToColumn(i)}
                aria-current={activeCol === i ? 'true' : undefined}
              >
                <span className="max-w-[7rem] truncate">{t(col.headerKey)}</span>
                <span className="ml-1.5 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                  {columnCounts[i]}
                </span>
              </Button>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{tKanban('kanbanSwipeHint')}</p>
        </>
      )}

      <div
        ref={boardRef}
        className={cn(
          'flex min-h-0 flex-1 gap-3 pb-2',
          'md:flex-row md:flex-nowrap md:overflow-x-auto',
          'max-md:snap-x max-md:snap-mandatory max-md:flex-row max-md:flex-nowrap max-md:overflow-x-auto max-md:overflow-y-visible',
          'max-md:-mx-4 max-md:scroll-pl-4 max-md:scroll-pr-4 max-md:px-4',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
      >
        {KANBAN_COLUMNS.map((col, i) => (
          <div
            key={col.status}
            ref={(el) => {
              columnRefs.current[i] = el;
            }}
            className={cn(
              'flex min-h-0 flex-col',
              'max-md:snap-center max-md:shrink-0 max-md:w-[min(22rem,calc(100vw-2rem))]',
              'md:w-auto md:min-w-0 md:snap-none md:shrink-0',
            )}
          >
            <KanbanColumn
              column={col}
              tasks={byStatus[col.status]}
              onOpenTask={onOpenTask}
              incidents={col.status === 'issue' ? boardIncidents : undefined}
              onOpenIncident={col.status === 'issue' ? onOpenIncident : undefined}
              incidentColumnHint={col.status === 'issue'}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
