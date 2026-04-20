'use client';

import { cn } from '@/lib/utils';
import { ShieldAlert, CheckCircle2 } from 'lucide-react';
import type { VoiceAlert } from '@/lib/api/calls-admin';

interface Props {
  alerts: VoiceAlert[];
}

export function AlertSummaryBar({ alerts }: Props) {
  const critical = alerts.filter((a) => a.severity === 'critical' && a.status === 'active');
  const warnings = alerts.filter((a) => a.severity === 'warning' && a.status === 'active');

  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 py-2 text-xs text-teal-800 dark:border-teal-800/30 dark:bg-teal-950/40 dark:text-teal-400">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>Все метрики в норме</span>
      </div>
    );
  }

  return (
    <div className={cn(
      'flex items-center gap-3 rounded-lg border px-3 py-2 text-xs',
      critical.length > 0
        ? 'border-red-500/35 bg-red-500/10 text-red-800 dark:border-red-700/40 dark:bg-red-950/40 dark:text-red-300'
        : 'border-amber-500/35 bg-amber-500/10 text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/40 dark:text-amber-300',
    )}>
      <ShieldAlert className="h-4 w-4 shrink-0 animate-pulse" />
      <div className="flex items-center gap-3 flex-wrap">
        {critical.length > 0 && (
          <span className="font-semibold text-red-900 dark:text-red-200">
            {critical.length} критич.
          </span>
        )}
        {warnings.length > 0 && (
          <span>{warnings.length} предупрежд.</span>
        )}
        <span className="hidden text-muted-foreground sm:inline dark:text-slate-400">
          {[...new Set(alerts.map((a) => a.metricKey))].join(', ')}
        </span>
      </div>
    </div>
  );
}
