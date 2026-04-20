'use client';

import { useQaWorkload } from '@/hooks/use-calls-admin';
import { cn } from '@/lib/utils';
import { Users } from 'lucide-react';

interface WorkloadBarProps {
  label: string;
  value: number;
  max: number;
  color: string;
}

function WorkloadBar({ label, value, max, color }: WorkloadBarProps) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 truncate text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted dark:bg-slate-800">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-right font-mono text-foreground dark:text-slate-300">{value}</span>
    </div>
  );
}

export function QaWorkloadWidget() {
  const { data = [], isLoading } = useQaWorkload();

  if (isLoading) {
    return (
      <div className="space-y-2 rounded-xl border border-border bg-muted/50 p-4 dark:border-slate-700/50 dark:bg-slate-800/50">
        <div className="h-4 w-24 animate-pulse rounded bg-muted dark:bg-slate-700" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-3 animate-pulse rounded bg-muted/80 dark:bg-slate-700/50" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-muted/50 p-4 text-center dark:border-slate-700/50 dark:bg-slate-800/50">
        <Users className="mx-auto mb-1 h-5 w-5 text-muted-foreground dark:text-slate-600" />
        <p className="text-xs text-muted-foreground">Нет назначенных ревью</p>
      </div>
    );
  }

  const maxOpen = Math.max(...data.map((d) => d.openCount + d.inReviewCount + d.escalatedCount), 1);

  return (
    <div className="rounded-xl border border-border bg-muted/50 p-4 dark:border-slate-700/50 dark:bg-slate-800/50">
      <div className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground dark:text-slate-300">Workload</span>
      </div>

      <div className="space-y-2.5">
        {data.map((row) => {
          const total = row.openCount + row.inReviewCount + row.escalatedCount;
          const hasOverdue = row.overdueCount > 0;
          return (
            <div key={row.assigneeId} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="max-w-[120px] truncate font-mono text-xs text-foreground dark:text-slate-300">
                  {row.assigneeId.slice(0, 8)}…
                </span>
                <div className="flex items-center gap-1">
                  {hasOverdue && (
                    <span className="text-[10px] px-1 rounded bg-red-900/40 text-red-400 font-semibold">
                      {row.overdueCount} просроч.
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground dark:text-slate-500">{total} итого</span>
                </div>
              </div>
              <WorkloadBar
                label="open"
                value={row.openCount}
                max={maxOpen}
                color="bg-teal-500"
              />
              <WorkloadBar
                label="in review"
                value={row.inReviewCount}
                max={maxOpen}
                color="bg-cyan-500"
              />
              {row.escalatedCount > 0 && (
                <WorkloadBar
                  label="escalated"
                  value={row.escalatedCount}
                  max={maxOpen}
                  color="bg-red-500"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
