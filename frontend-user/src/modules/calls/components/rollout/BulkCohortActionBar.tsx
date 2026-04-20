'use client';

import { useState } from 'react';
import { useBulkMoveCohort } from '@/hooks/use-calls-admin';
import { cn } from '@/lib/utils';
import type { RolloutCohort } from '@/lib/api/calls-admin';

const COHORTS: { value: RolloutCohort; label: string }[] = [
  { value: 'disabled', label: 'Disabled' },
  { value: 'pilot',    label: 'Pilot' },
  { value: 'beta',     label: 'Beta' },
  { value: 'stable',   label: 'Stable' },
];

interface Props {
  selectedIds: string[];
  onClear: () => void;
}

export function BulkCohortActionBar({ selectedIds, onClear }: Props) {
  const [targetCohort, setTargetCohort] = useState<RolloutCohort>('pilot');
  const bulkMove = useBulkMoveCohort();

  if (selectedIds.length === 0) return null;

  const handleMove = async () => {
    await bulkMove.mutateAsync({ propertyIds: selectedIds, cohort: targetCohort });
    onClear();
  };

  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card/95 px-4 py-2.5 text-sm backdrop-blur dark:border-slate-700/60 dark:bg-slate-800/90">
      <span className="font-medium text-foreground dark:text-slate-300">{selectedIds.length} выбрано</span>

      <div className="flex items-center gap-1 ml-2">
        {COHORTS.map((c) => (
          <button
            key={c.value}
            onClick={() => setTargetCohort(c.value)}
            className={cn(
              'px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
              targetCohort === c.value
                ? 'bg-cyan-700/40 border-cyan-500/60 text-cyan-200'
                : 'border-border bg-muted text-muted-foreground hover:text-foreground dark:border-slate-600/40 dark:bg-slate-700/40 dark:text-slate-400 dark:hover:text-slate-200',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <button
        onClick={handleMove}
        disabled={bulkMove.isPending}
        className="ml-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40 dark:bg-cyan-600 dark:hover:bg-cyan-500 dark:text-white"
      >
        {bulkMove.isPending ? 'Перемещаем...' : `Переместить в ${targetCohort}`}
      </button>

      <button
        onClick={onClear}
        className="ml-auto text-xs text-muted-foreground transition-colors hover:text-foreground dark:hover:text-slate-300"
      >
        Сбросить
      </button>
    </div>
  );
}
