'use client';

import { cn } from '@/lib/utils';
import { CheckCircle2, Clock, ShieldAlert } from 'lucide-react';
import { useAcknowledgeAlert, useResolveAlert } from '@/hooks/use-calls-admin';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { VoiceAlert } from '@/lib/api/calls-admin';

const METRIC_LABELS: Record<string, string> = {
  fallbackRate: 'Fallback rate',
  escalationRate: 'Escalation rate',
  lowConfidenceRate: 'Low confidence',
  p95LatencyMs: 'P95 latency',
  webhookFailures24h: 'Webhook failures 24h',
  failedTransfers24h: 'Failed transfers 24h',
  emergencyTriggers24h: 'Emergency triggers 24h',
};

function formatValue(key: string, value: number): string {
  if (key.endsWith('Rate')) return `${(value * 100).toFixed(1)}%`;
  if (key.endsWith('Ms')) return `${Math.round(value)}ms`;
  return String(Math.round(value));
}

interface AlertRowProps {
  alert: VoiceAlert;
}

function AlertRow({ alert }: AlertRowProps) {
  const ack = useAcknowledgeAlert();
  const resolve = useResolveAlert();

  const isCritical = alert.severity === 'critical';
  const isAcked = alert.status === 'acknowledged';

  return (
    <div className={cn(
      'flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors',
      isCritical
        ? 'bg-red-950/30 border-red-800/40 hover:bg-red-950/50'
        : 'bg-amber-950/25 border-amber-800/30 hover:bg-amber-950/40',
    )}>
      <ShieldAlert className={cn('h-4 w-4 mt-0.5 shrink-0', isCritical ? 'text-red-400' : 'text-amber-400')} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('text-sm font-medium', isCritical ? 'text-red-200' : 'text-amber-200')}>
            {METRIC_LABELS[alert.metricKey] ?? alert.metricKey}
          </span>
          <span className={cn(
            'text-xs px-1.5 py-0.5 rounded font-mono font-semibold',
            isCritical ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300',
          )}>
            {formatValue(alert.metricKey, alert.currentValue)}
          </span>
          <span className="text-xs text-slate-500">
            порог: {formatValue(alert.metricKey, alert.thresholdValue)}
          </span>
          {isAcked && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">ack</span>
          )}
        </div>
        <div className="text-xs text-slate-500 mt-0.5">
          {formatDistanceToNow(new Date(alert.lastTriggeredAt), { addSuffix: true, locale: ru })}
          {alert.propertyId && <span className="ml-2 text-slate-600">· property {alert.propertyId.slice(0, 8)}</span>}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {!isAcked && alert.status === 'active' && (
          <button
            onClick={() => ack.mutate(alert.id)}
            disabled={ack.isPending}
            className="p-1 rounded text-slate-400 hover:text-amber-300 hover:bg-amber-900/20 transition-colors disabled:opacity-40"
            title="Подтвердить"
          >
            <Clock className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={() => resolve.mutate(alert.id)}
          disabled={resolve.isPending}
          className="p-1 rounded text-slate-400 hover:text-teal-300 hover:bg-teal-900/20 transition-colors disabled:opacity-40"
          title="Разрешить"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

interface Props {
  alerts: VoiceAlert[];
  isLoading?: boolean;
}

export function ActiveAlertsPanel({ alerts, isLoading }: Props) {
  const active = alerts.filter((a) => a.status !== 'resolved');

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-14 rounded-lg bg-slate-800/50 animate-pulse" />
        ))}
      </div>
    );
  }

  if (active.length === 0) return null;

  return (
    <div className="space-y-2">
      {active.map((a) => <AlertRow key={a.id} alert={a} />)}
    </div>
  );
}
