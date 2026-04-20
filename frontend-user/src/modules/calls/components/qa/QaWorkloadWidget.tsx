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
      <span className="w-16 text-slate-400 truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-right text-slate-300 font-mono">{value}</span>
    </div>
  );
}

export function QaWorkloadWidget() {
  const { data = [], isLoading } = useQaWorkload();

  if (isLoading) {
    return (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 space-y-2">
        <div className="h-4 w-24 bg-slate-700 rounded animate-pulse" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-3 bg-slate-700/50 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 text-center">
        <Users className="h-5 w-5 text-slate-600 mx-auto mb-1" />
        <p className="text-xs text-slate-500">Нет назначенных ревью</p>
      </div>
    );
  }

  const maxOpen = Math.max(...data.map((d) => d.openCount + d.inReviewCount + d.escalatedCount), 1);

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users className="h-4 w-4 text-slate-400" />
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Workload</span>
      </div>

      <div className="space-y-2.5">
        {data.map((row) => {
          const total = row.openCount + row.inReviewCount + row.escalatedCount;
          const hasOverdue = row.overdueCount > 0;
          return (
            <div key={row.assigneeId} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300 font-mono truncate max-w-[120px]">
                  {row.assigneeId.slice(0, 8)}…
                </span>
                <div className="flex items-center gap-1">
                  {hasOverdue && (
                    <span className="text-[10px] px-1 rounded bg-red-900/40 text-red-400 font-semibold">
                      {row.overdueCount} просроч.
                    </span>
                  )}
                  <span className="text-[10px] text-slate-500">{total} итого</span>
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
