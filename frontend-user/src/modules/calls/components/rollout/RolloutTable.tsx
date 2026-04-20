'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useUpdateRollout } from '@/hooks/use-calls-admin';
import { AlertTriangle, CheckCircle2, XCircle, ChevronDown } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { RolloutDashboardProperty, RolloutCohort } from '@/lib/api/calls-admin';

const COHORT_COLORS: Record<RolloutCohort, string> = {
  disabled: 'bg-muted text-muted-foreground dark:bg-slate-700/50 dark:text-slate-400',
  pilot: 'bg-amber-500/15 text-amber-900 dark:bg-amber-900/40 dark:text-amber-300',
  beta: 'bg-cyan-500/15 text-cyan-900 dark:bg-cyan-900/40 dark:text-cyan-300',
  stable: 'bg-teal-500/15 text-teal-900 dark:bg-teal-900/40 dark:text-teal-300',
};

const WARNING_LABELS: Record<string, string> = {
  active_alerts:   '⚠ Активные алерты',
  no_recent_calls: '○ Нет звонков 7d',
  high_fallback:   '↑ Высокий fallback',
};

interface RowActionsProps {
  row: RolloutDashboardProperty;
}

function RowActions({ row }: RowActionsProps) {
  const [open, setOpen] = useState(false);
  const update = useUpdateRollout();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground dark:hover:text-slate-200"
      >
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-border bg-popover py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800"
          onMouseLeave={() => setOpen(false)}
        >
          <button
            onClick={() => { update.mutate({ propertyId: row.propertyId, enabled: !row.enabled }); setOpen(false); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-popover-foreground hover:bg-muted dark:text-slate-300 dark:hover:bg-slate-700/50"
          >
            {row.enabled ? <XCircle className="h-3.5 w-3.5 text-red-400" /> : <CheckCircle2 className="h-3.5 w-3.5 text-teal-400" />}
            {row.enabled ? 'Выключить' : 'Включить'}
          </button>

          {(['pilot', 'beta', 'stable'] as RolloutCohort[]).map((c) => (
            <button
              key={c}
              onClick={() => { update.mutate({ propertyId: row.propertyId, cohort: c }); setOpen(false); }}
              className={cn(
                'w-full px-3 py-2 text-left text-xs hover:bg-muted dark:hover:bg-slate-700/50',
                row.cohort === c ? 'text-primary dark:text-cyan-400' : 'text-muted-foreground dark:text-slate-400',
              )}
            >
              → Cohort: {c}
            </button>
          ))}

          {['retell', 'vapi'].map((p) => (
            <button
              key={p}
              onClick={() => { update.mutate({ propertyId: row.propertyId, provider: p }); setOpen(false); }}
              className={cn(
                'w-full px-3 py-2 text-left text-xs hover:bg-muted dark:hover:bg-slate-700/50',
                row.provider === p ? 'text-primary dark:text-cyan-400' : 'text-muted-foreground dark:text-slate-400',
              )}
            >
              → Provider: {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  properties: RolloutDashboardProperty[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  isLoading?: boolean;
}

export function RolloutTable({ properties, selectedIds, onToggleSelect, onSelectAll, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-muted dark:bg-slate-800/50" />
        ))}
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-sm">Нет объектов для отображения</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border dark:border-slate-700/60">
            <th className="w-8 pb-2 text-left">
              <input
                type="checkbox"
                className="accent-cyan-500"
                checked={selectedIds.size === properties.length && properties.length > 0}
                onChange={(e) => e.target.checked ? onSelectAll(properties.map((p) => p.propertyId)) : onSelectAll([])}
              />
            </th>
            <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Объект</th>
            <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cohort</th>
            <th className="pb-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">Статус</th>
            <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Provider</th>
            <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Звонки 7d</th>
            <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Алерты</th>
            <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Последний</th>
            <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Статус</th>
            <th className="w-8 pb-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border dark:divide-slate-800/60">
          {properties.map((row) => {
            const hasWarning = row.warningState.length > 0;
            const hasAlert = row.activeAlertsCount > 0;
            return (
              <tr key={row.propertyId} className={cn('group transition-colors hover:bg-muted/80 dark:hover:bg-slate-800/30', selectedIds.has(row.propertyId) && 'bg-muted/60 dark:bg-slate-800/20')}>
                <td className="py-2.5 pr-2">
                  <input
                    type="checkbox"
                    className="accent-cyan-500"
                    checked={selectedIds.has(row.propertyId)}
                    onChange={() => onToggleSelect(row.propertyId)}
                  />
                </td>
                <td className="py-2.5">
                  <span className="font-medium text-foreground dark:text-slate-200">{row.propertyName ?? row.propertyId.slice(0, 8)}</span>
                </td>
                <td className="py-2.5">
                  <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', COHORT_COLORS[row.cohort])}>
                    {row.cohort}
                  </span>
                </td>
                <td className="py-2.5 text-center">
                  {row.enabled
                    ? <CheckCircle2 className="h-4 w-4 text-teal-400 mx-auto" />
                    : <XCircle className="mx-auto h-4 w-4 text-muted-foreground dark:text-slate-600" />
                  }
                </td>
                <td className="py-2.5 text-xs capitalize text-muted-foreground dark:text-slate-400">{row.provider}</td>
                <td className="py-2.5 text-right tabular-nums text-foreground dark:text-slate-300">{row.callsLast7d}</td>
                <td className="py-2.5 text-right">
                  {hasAlert
                    ? <span className="text-xs font-semibold text-red-400">{row.activeAlertsCount}</span>
                    : <span className="text-xs text-muted-foreground dark:text-slate-600">—</span>
                  }
                </td>
                <td className="py-2.5 text-xs text-muted-foreground dark:text-slate-500">
                  {row.lastCallAt
                    ? formatDistanceToNow(new Date(row.lastCallAt), { addSuffix: true, locale: ru })
                    : '—'
                  }
                </td>
                <td className="py-2.5">
                  {hasWarning && (
                    <div className="flex flex-col gap-0.5">
                      {row.warningState.map((w) => (
                        <span key={w} className="text-[10px] text-amber-400 flex items-center gap-0.5">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          {WARNING_LABELS[w] ?? w}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="py-2.5">
                  <RowActions row={row} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
