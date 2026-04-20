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
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-teal-950/40 border border-teal-800/30 text-teal-400 text-xs">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>Все метрики в норме</span>
      </div>
    );
  }

  return (
    <div className={cn(
      'flex items-center gap-3 px-3 py-2 rounded-lg border text-xs',
      critical.length > 0
        ? 'bg-red-950/40 border-red-700/40 text-red-300'
        : 'bg-amber-950/40 border-amber-700/40 text-amber-300',
    )}>
      <ShieldAlert className="h-4 w-4 shrink-0 animate-pulse" />
      <div className="flex items-center gap-3 flex-wrap">
        {critical.length > 0 && (
          <span className="font-semibold text-red-200">
            {critical.length} критич.
          </span>
        )}
        {warnings.length > 0 && (
          <span>{warnings.length} предупрежд.</span>
        )}
        <span className="text-slate-400 hidden sm:inline">
          {[...new Set(alerts.map((a) => a.metricKey))].join(', ')}
        </span>
      </div>
    </div>
  );
}
