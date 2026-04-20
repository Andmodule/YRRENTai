'use client';

import { cn } from '@/lib/utils';
import type { RolloutDashboard, RolloutCohort } from '@/lib/api/calls-admin';

const COHORT_META: Record<RolloutCohort, { label: string; color: string; bg: string; border: string }> = {
  disabled: {
    label: 'Disabled',
    color: 'text-muted-foreground dark:text-slate-400',
    bg: 'bg-muted/70 dark:bg-slate-800/50',
    border: 'border-border dark:border-slate-700/50',
  },
  pilot: {
    label: 'Pilot',
    color: 'text-amber-800 dark:text-amber-300',
    bg: 'bg-amber-500/10 dark:bg-amber-950/30',
    border: 'border-amber-500/35 dark:border-amber-800/40',
  },
  beta: {
    label: 'Beta',
    color: 'text-cyan-800 dark:text-cyan-300',
    bg: 'bg-cyan-500/10 dark:bg-cyan-950/30',
    border: 'border-cyan-500/35 dark:border-cyan-800/40',
  },
  stable: {
    label: 'Stable',
    color: 'text-teal-800 dark:text-teal-300',
    bg: 'bg-teal-500/10 dark:bg-teal-950/30',
    border: 'border-teal-500/35 dark:border-teal-800/40',
  },
};

interface Props {
  summary: RolloutDashboard['summary'];
  isLoading?: boolean;
}

export function CohortSummaryCards({ summary, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-muted dark:bg-slate-800/50" />
        ))}
      </div>
    );
  }

  const cohorts: RolloutCohort[] = ['disabled', 'pilot', 'beta', 'stable'];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cohorts.map((cohort) => {
        const meta = COHORT_META[cohort];
        const count = summary.byCohort[cohort] ?? 0;
        return (
          <div key={cohort} className={cn('rounded-xl border p-3', meta.bg, meta.border)}>
            <p className={cn('text-xs font-semibold uppercase tracking-wide mb-1', meta.color)}>
              {meta.label}
            </p>
            <p className="text-2xl font-bold text-foreground dark:text-white">{count}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">объектов</p>
          </div>
        );
      })}
    </div>
  );
}
