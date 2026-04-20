'use client';

import { useSystemHealth } from '@/hooks/use-calls-stats';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Webhook,
  BrainCircuit,
  CopyX,
  BookX,
  Siren,
  ArrowRightLeft,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type HealthRange = '24h' | '7d';

interface HealthMetric {
  key: keyof import('@/lib/api/calls-stats').SystemHealth;
  label: string;
  icon: LucideIcon;
  format?: 'count' | 'pct';
  warnThreshold: number;
  critThreshold: number;
}

const METRICS: HealthMetric[] = [
  { key: 'webhookFailureCount',         label: 'Webhook failures',        icon: Webhook,       format: 'count', warnThreshold: 1, critThreshold: 5 },
  { key: 'structuredOutputFailureCount',label: 'Structured output fails',  icon: BrainCircuit,  format: 'count', warnThreshold: 2, critThreshold: 10 },
  { key: 'duplicateEventCount',         label: 'Дублированные события',   icon: CopyX,         format: 'count', warnThreshold: 1, critThreshold: 5 },
  { key: 'kbMissRate',                  label: 'KB miss rate',             icon: BookX,         format: 'pct',   warnThreshold: 10, critThreshold: 25 },
  { key: 'emergencyGuardTriggers',      label: 'Emergency triggers',       icon: Siren,         format: 'count', warnThreshold: 1, critThreshold: 3 },
  { key: 'failedTransfersLast24h',      label: 'Неудачные трансферы 24h', icon: ArrowRightLeft, format: 'count', warnThreshold: 1, critThreshold: 3 },
];

interface SystemHealthGridProps {
  range?: HealthRange;
  className?: string;
}

export function SystemHealthGrid({ range = '24h', className }: SystemHealthGridProps) {
  const { data, isLoading } = useSystemHealth(range);

  return (
    <div className={cn('grid grid-cols-2 sm:grid-cols-3 gap-2', className)}>
      {METRICS.map((m) => {
        const raw = data?.[m.key];
        const value = typeof raw === 'number' ? raw : null;
        const display = value === null ? null
          : m.format === 'pct' ? `${value}%`
          : String(value);

        const severity: 'normal' | 'warn' | 'crit' =
          value === null ? 'normal'
          : value >= m.critThreshold ? 'crit'
          : value >= m.warnThreshold ? 'warn'
          : 'normal';

        return (
          <HealthCard
            key={m.key}
            label={m.label}
            value={display}
            icon={m.icon}
            severity={severity}
            isLoading={isLoading}
          />
        );
      })}
    </div>
  );
}

function HealthCard({
  label,
  value,
  icon: Icon,
  severity,
  isLoading,
}: {
  label: string;
  value: string | null;
  icon: LucideIcon;
  severity: 'normal' | 'warn' | 'crit';
  isLoading: boolean;
}) {
  const colors = {
    normal: { bg: 'bg-slate-50 ring-slate-200', text: 'text-slate-700', icon: 'text-slate-400' },
    warn:   { bg: 'bg-amber-50 ring-amber-200', text: 'text-amber-800', icon: 'text-amber-500' },
    crit:   { bg: 'bg-red-50 ring-red-200',     text: 'text-red-800',   icon: 'text-red-500' },
  }[severity];

  return (
    <div className={cn('rounded-xl ring-1 px-3 py-2.5 flex items-center gap-2.5', colors.bg)}>
      <Icon className={cn('h-4 w-4 shrink-0', colors.icon)} />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide truncate">{label}</div>
        {isLoading ? (
          <Skeleton className="h-5 w-10 rounded mt-0.5" />
        ) : (
          <div className={cn('text-sm font-bold tabular-nums', colors.text)}>
            {value ?? '—'}
          </div>
        )}
      </div>
    </div>
  );
}
