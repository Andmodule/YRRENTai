'use client';

import { cn } from '@/lib/utils';
import type { RolloutDashboard } from '@/lib/api/calls-admin';

interface Props {
  summary: RolloutDashboard['summary'];
  isLoading?: boolean;
}

export function ProviderSummaryCards({ summary, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="flex gap-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-16 w-28 animate-pulse rounded-xl bg-muted dark:bg-slate-800/50" />
        ))}
      </div>
    );
  }

  const providers = Object.entries(summary.byProvider);

  if (providers.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {providers.map(([provider, count]) => (
        <div
          key={provider}
          className="flex min-w-[90px] flex-col items-center justify-center rounded-xl border border-border bg-muted/60 px-4 py-2.5 dark:border-slate-700/50 dark:bg-slate-800/50"
        >
          <p className="text-xs font-medium capitalize text-muted-foreground">{provider}</p>
          <p className="mt-0.5 text-xl font-bold text-foreground dark:text-white">{count}</p>
        </div>
      ))}
      <div className="flex flex-col items-center justify-center rounded-xl border border-teal-800/30 bg-teal-950/20 px-4 py-2.5 min-w-[90px]">
        <p className="text-xs text-teal-400 font-medium">Включено</p>
        <p className="mt-0.5 text-xl font-bold text-foreground dark:text-white">{summary.totalEnabled}</p>
      </div>
    </div>
  );
}
