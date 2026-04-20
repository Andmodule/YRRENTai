'use client';

import { cn } from '@/lib/utils';
import type { RolloutDashboard, RolloutCohort } from '@/lib/api/calls-admin';

const COHORT_META: Record<RolloutCohort, { label: string; color: string; bg: string; border: string }> = {
  disabled: { label: 'Disabled',  color: 'text-slate-400',  bg: 'bg-slate-800/50',   border: 'border-slate-700/50' },
  pilot:    { label: 'Pilot',     color: 'text-amber-300',  bg: 'bg-amber-950/30',   border: 'border-amber-800/40' },
  beta:     { label: 'Beta',      color: 'text-cyan-300',   bg: 'bg-cyan-950/30',    border: 'border-cyan-800/40' },
  stable:   { label: 'Stable',    color: 'text-teal-300',   bg: 'bg-teal-950/30',    border: 'border-teal-800/40' },
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
          <div key={i} className="h-20 rounded-xl bg-slate-800/50 animate-pulse" />
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
            <p className="text-2xl font-bold text-white">{count}</p>
            <p className="text-xs text-slate-500 mt-0.5">объектов</p>
          </div>
        );
      })}
    </div>
  );
}
