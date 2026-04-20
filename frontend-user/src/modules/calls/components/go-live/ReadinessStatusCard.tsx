'use client';

import { cn } from '@/lib/utils';
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';
import type { GoLiveReadiness, ReadinessStatus } from '@/lib/api/calls-admin';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';

const STATUS_CONFIG: Record<ReadinessStatus, {
  icon: React.ElementType;
  label: string;
  bg: string;
  border: string;
  text: string;
  iconColor: string;
}> = {
  ready: {
    icon: CheckCircle2,
    label: 'Готово к запуску',
    bg: 'bg-teal-500/10 dark:bg-teal-950/40',
    border: 'border-teal-500/35 dark:border-teal-700/50',
    text: 'text-teal-900 dark:text-teal-200',
    iconColor: 'text-teal-600 dark:text-teal-400',
  },
  warning: {
    icon: AlertTriangle,
    label: 'Требует внимания',
    bg: 'bg-amber-500/10 dark:bg-amber-950/30',
    border: 'border-amber-500/35 dark:border-amber-700/40',
    text: 'text-amber-950 dark:text-amber-200',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  blocked: {
    icon: XCircle,
    label: 'Заблокирован',
    bg: 'bg-red-500/10 dark:bg-red-950/30',
    border: 'border-red-500/35 dark:border-red-700/40',
    text: 'text-red-900 dark:text-red-200',
    iconColor: 'text-red-600 dark:text-red-400',
  },
};

interface Props {
  readiness: GoLiveReadiness;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function ReadinessStatusCard({ readiness, onRefresh, isRefreshing }: Props) {
  const cfg = STATUS_CONFIG[readiness.overallStatus];
  const Icon = cfg.icon;

  const passCount = readiness.checks.filter((c) => c.status === 'pass').length;
  const warnCount = readiness.checks.filter((c) => c.status === 'warn').length;
  const failCount = readiness.checks.filter((c) => c.status === 'fail').length;

  return (
    <div className={cn('rounded-xl border p-5', cfg.bg, cfg.border)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Icon className={cn('h-8 w-8 shrink-0', cfg.iconColor)} />
          <div>
            <p className={cn('text-lg font-bold', cfg.text)}>{cfg.label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground dark:text-slate-400">
              Проверено {formatDistanceToNow(new Date(readiness.checkedAt), { addSuffix: true, locale: ru })}
            </p>
          </div>
        </div>

        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="rounded-lg border border-border bg-muted/50 p-1.5 text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground disabled:opacity-40 dark:border-slate-700 dark:bg-transparent dark:hover:border-slate-600 dark:hover:text-white"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
        </button>
      </div>

      <div className="mt-4 flex items-center gap-4 border-t border-border pt-4 dark:border-slate-700/40">
        <Pill count={passCount} color="teal" label="Passed" />
        <Pill count={warnCount} color="amber" label="Warnings" />
        <Pill count={failCount} color="red" label="Failed" />
        <div className="ml-auto text-xs text-muted-foreground dark:text-slate-500">
          {readiness.env.provider} · {readiness.rollout.enabledPropertiesCount} enabled
        </div>
      </div>
    </div>
  );
}

function Pill({ count, color, label }: { count: number; color: 'teal' | 'amber' | 'red'; label: string }) {
  const colors = {
    teal: 'bg-teal-500/15 text-teal-800 ring-teal-500/30 dark:text-teal-300',
    amber: 'bg-amber-500/15 text-amber-900 ring-amber-500/30 dark:text-amber-300',
    red: 'bg-red-500/15 text-red-800 ring-red-500/30 dark:text-red-300',
  };
  return (
    <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1', colors[color])}>
      <span>{count}</span>
      <span className="font-normal opacity-80">{label}</span>
    </div>
  );
}
