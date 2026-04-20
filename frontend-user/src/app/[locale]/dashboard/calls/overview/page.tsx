'use client';

import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { useOverviewStats, useOverviewTrends, useSystemHealth, useAlerts } from '@/hooks/use-calls-admin';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  Radio, PhoneCall, Zap, ArrowRightLeft,
  ShieldAlert, TrendingDown, Timer, ClipboardCheck,
  RefreshCw, Activity, AlertTriangle, Webhook, BrainCircuit,
  BookX, Siren, Layers,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { TrendPoint } from '@/lib/api/calls-admin';
import { AlertSummaryBar } from '@/modules/calls/components/overview/AlertSummaryBar';
import { ActiveAlertsPanel } from '@/modules/calls/components/overview/ActiveAlertsPanel';

type Range = 'today' | '7d' | '30d';

// ── Simple SVG sparkline ──────────────────────────────────────────────────────

function Sparkline({ values, color = 'cyan' }: { values: (number | null)[]; color?: string }) {
  const clean = values.filter((v): v is number => v !== null);
  if (clean.length < 2) return <div className="h-6 w-16" />;
  const min = Math.min(...clean), max = Math.max(...clean), range = max - min || 1;
  const W = 64, H = 24;
  const step = W / (values.length - 1);
  const pts = values.map((v, i) => v === null ? null : `${i * step},${H - ((v - min) / range) * (H - 4) - 2}`).filter(Boolean).join(' ');
  const stroke = { cyan: '#22d3ee', amber: '#f59e0b', red: '#ef4444', teal: '#14b8a6' }[color] ?? '#22d3ee';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden className="opacity-70">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, icon: Icon, color = 'default', pulse, isLoading, href, sparkline,
}: {
  label: string; value: string | number | null | undefined; icon: React.ElementType;
  color?: 'default' | 'cyan' | 'amber' | 'red'; pulse?: boolean;
  isLoading?: boolean; href?: string; sparkline?: React.ReactNode;
}) {
  const colors = {
    default: 'border-border bg-card dark:border-slate-700 dark:bg-slate-800/70',
    cyan: 'border-cyan-500/30 bg-cyan-500/10',
    amber: 'border-amber-500/30 bg-amber-500/10',
    red: 'border-red-500/30 bg-red-500/10',
  };
  const textColors = {
    default: 'text-foreground dark:text-white',
    cyan: 'text-cyan-800 dark:text-cyan-200',
    amber: 'text-amber-800 dark:text-amber-200',
    red: 'text-red-800 dark:text-red-200',
  };
  const iconColors = {
    default: 'text-muted-foreground dark:text-slate-400',
    cyan: 'text-cyan-600 dark:text-cyan-400',
    amber: 'text-amber-600 dark:text-amber-400',
    red: 'text-red-500 dark:text-red-400',
  };

  const inner = (
    <div className={cn(
      'flex flex-col gap-2 rounded-xl border p-3 sm:p-4 transition-all',
      colors[color],
      href && 'cursor-pointer hover:brightness-110',
      pulse && 'ring-1 ring-cyan-500/50',
    )}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest leading-none text-muted-foreground">{label}</span>
        <Icon className={cn('h-4 w-4 shrink-0', iconColors[color])} />
      </div>
      {isLoading ? (
        <Skeleton className="h-7 w-14 bg-muted dark:bg-slate-700" />
      ) : (
        <span className={cn('text-xl font-bold tabular-nums leading-none', textColors[color])}>
          {value ?? '—'}
        </span>
      )}
      {sparkline && <div className="mt-auto">{sparkline}</div>}
    </div>
  );

  return href ? <Link href={href}>{inner}</Link> : inner;
}

// ── Trend row ─────────────────────────────────────────────────────────────────

function TrendBlock({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-4 dark:border-slate-700 dark:bg-slate-800/50">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Тренды</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { key: 'callsCompleted' as const, label: 'Звонков', color: 'cyan' },
          { key: 'escalationRate' as const, label: 'Эскалация %', color: 'amber' },
          { key: 'handoffRate' as const, label: 'Handoff %', color: 'teal' },
          { key: 'p50TurnLatencyMs' as const, label: 'p50 ms', color: 'cyan' },
        ].map(({ key, label, color }) => (
          <div key={key} className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
            <Sparkline values={points.map((p) => p[key])} color={color} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── System health ─────────────────────────────────────────────────────────────

function HealthCard({ label, value, icon: Icon, warn, crit }: {
  label: string; value: number | undefined; icon: React.ElementType; warn: number; crit: number;
}) {
  const n = value ?? 0;
  const sev = n >= crit ? 'crit' : n >= warn ? 'warn' : 'ok';
  const colors = {
    ok: 'border-border bg-muted/60 text-foreground dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300',
    warn: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200',
    crit: 'border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200',
  };
  return (
    <div className={cn('flex items-center gap-2 rounded-xl border px-3 py-2.5', colors[sev])}>
      <Icon className="h-4 w-4 shrink-0 opacity-70" />
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-sm font-bold tabular-nums">{value ?? '—'}</div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CallsOverviewPage() {
  const [range, setRange] = useState<Range>('today');
  const { data: stats, isLoading, refetch } = useOverviewStats();
  const { data: trends } = useOverviewTrends(range);
  const { data: health } = useSystemHealth('24h');
  const { data: alerts = [], isLoading: alertsLoading } = useAlerts({ status: 'active' });

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* Alert Summary Bar */}
      <AlertSummaryBar alerts={alerts} />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-base font-bold text-foreground">Обзор голосового AI</h1>
          <p className="text-xs text-muted-foreground">Обновляется каждые 15 с</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border text-xs font-medium dark:border-slate-700">
            {(['today', '7d', '30d'] as Range[]).map((r) => (
              <button key={r} onClick={() => setRange(r)}
                className={cn('px-2.5 py-1.5 transition-colors',
                  range === r ? 'bg-primary/15 text-primary dark:bg-cyan-500/20 dark:text-cyan-300' : 'bg-muted text-muted-foreground hover:bg-accent dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700')}>
                {r === 'today' ? 'Сег.' : r}
              </button>
            ))}
          </div>
          <button onClick={() => void refetch()}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground transition-colors hover:text-foreground dark:border-slate-700 dark:bg-slate-800 dark:hover:text-slate-200">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* KPI row 1 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Активных сейчас" value={stats?.activeSessions} icon={Radio}
          color={stats?.activeSessions ? 'cyan' : 'default'} pulse={!!stats?.activeSessions}
          isLoading={isLoading} href="/dashboard/calls/live" />
        <KpiCard label="Звонков сегодня" value={stats?.callsToday} icon={PhoneCall}
          isLoading={isLoading}
          sparkline={<Sparkline values={(trends?.points ?? []).map((p) => p.callsCompleted)} />} />
        <KpiCard label="Эскалировано" value={stats?.escalatedPct !== undefined ? `${stats.escalatedPct}%` : null}
          icon={Zap} color={stats?.escalatedPct && stats.escalatedPct > 20 ? 'amber' : 'default'}
          isLoading={isLoading} href="/dashboard/calls/history?preset=escalated" />
        <KpiCard label="Handoff" value={stats?.handoffPct !== undefined ? `${stats.handoffPct}%` : null}
          icon={ArrowRightLeft} isLoading={isLoading} href="/dashboard/calls/history?preset=handed_off" />
      </div>

      {/* KPI row 2 */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <KpiCard label="Fallback" value={stats?.fallbackPct !== undefined ? `${stats.fallbackPct}%` : null}
          icon={ShieldAlert} color={stats?.fallbackPct && stats.fallbackPct > 15 ? 'amber' : 'default'}
          isLoading={isLoading} href="/dashboard/calls/history?preset=failed" />
        <KpiCard label="Низкая ув." value={stats?.lowConfidencePct !== undefined ? `${stats.lowConfidencePct}%` : null}
          icon={TrendingDown} color={stats?.lowConfidencePct && stats.lowConfidencePct > 25 ? 'red' : 'default'}
          isLoading={isLoading} />
        <KpiCard label="p50 latency" value={stats?.p50TurnLatencyMs !== null ? `${stats?.p50TurnLatencyMs}ms` : null}
          icon={Timer} color={stats?.p50TurnLatencyMs && stats.p50TurnLatencyMs > 1000 ? 'amber' : 'default'}
          isLoading={isLoading}
          sparkline={<Sparkline values={(trends?.points ?? []).map((p) => p.p50TurnLatencyMs)} />} />
        <KpiCard label="p95 latency" value={stats?.p95TurnLatencyMs !== null ? `${stats?.p95TurnLatencyMs}ms` : null}
          icon={Timer} color={stats?.p95TurnLatencyMs && stats.p95TurnLatencyMs > 2000 ? 'red' : 'default'}
          isLoading={isLoading} />
        <KpiCard label="QA очередь" value={stats?.pendingReviewsCount} icon={ClipboardCheck}
          color={stats?.pendingReviewsCount && stats.pendingReviewsCount > 5 ? 'amber' : 'default'}
          isLoading={isLoading} href="/dashboard/calls/qa?reviewStatus=open" />
      </div>

      {/* Active Alerts */}
      {(alertsLoading || alerts.length > 0) && (
        <div className="rounded-xl border border-border bg-card p-4 dark:border-slate-700 dark:bg-slate-800/50">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Активные алерты</h3>
            <div className="flex items-center gap-1.5">
              <Link href="/dashboard/calls/live"
                className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-primary dark:hover:text-cyan-300 dark:hover:bg-slate-700/50">
                Live →
              </Link>
              <Link href="/dashboard/calls/qa"
                className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-primary dark:hover:text-cyan-300 dark:hover:bg-slate-700/50">
                QA →
              </Link>
              <Link href="/dashboard/calls/rollout"
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-primary dark:hover:text-teal-300 dark:hover:bg-slate-700/50">
                <Layers className="h-3 w-3" />Rollout →
              </Link>
            </div>
          </div>
          <ActiveAlertsPanel alerts={alerts} isLoading={alertsLoading} />
        </div>
      )}

      {/* Trends */}
      {trends && <TrendBlock points={trends.points} />}

      {/* System Health */}
      <div className="rounded-xl border border-border bg-card p-4 dark:border-slate-700 dark:bg-slate-800/50">
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">System Health (24h)</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <HealthCard label="Webhook failures" value={health?.webhookFailureCount} icon={Webhook} warn={1} crit={5} />
          <HealthCard label="Structured output" value={health?.structuredOutputFailureCount} icon={BrainCircuit} warn={2} crit={10} />
          <HealthCard label="KB miss rate %" value={health?.kbMissRate} icon={BookX} warn={10} crit={25} />
          <HealthCard label="Emergency triggers" value={health?.emergencyGuardTriggers} icon={Siren} warn={1} crit={3} />
          <HealthCard label="Failed transfers" value={health?.failedTransfersLast24h} icon={ArrowRightLeft} warn={1} crit={3} />
          <HealthCard label="Duplicate events" value={health?.duplicateEventCount} icon={AlertTriangle} warn={1} crit={5} />
        </div>
      </div>

      {/* Alerts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <AlertList title="Последние эскалации (24ч)" items={stats?.recentEscalations ?? []}
          icon={Zap} emptyText="Эскалаций не было" accentColor="amber" />
        <AlertList title="Неудачные трансферы (24ч)" items={stats?.recentFailedTransfers ?? []}
          icon={ArrowRightLeft} emptyText="Сбоев трансфера не было" accentColor="red" />
      </div>
    </div>
  );
}

function AlertList({ title, items, icon: Icon, emptyText, accentColor }: {
  title: string;
  items: Array<{ sessionId: string; guestPhone: string | null; reason: string | null; occurredAt: string }>;
  icon: React.ElementType;
  emptyText: string;
  accentColor: 'amber' | 'red';
}) {
  const borderColor = accentColor === 'amber' ? 'border-amber-500/30' : 'border-red-500/30';
  return (
    <div className={cn('rounded-xl border bg-card p-4 dark:bg-slate-800/50', borderColor)}>
      <div className="mb-3 flex items-center gap-2">
        <Icon className={cn('h-4 w-4', accentColor === 'amber' ? 'text-amber-400' : 'text-red-400')} />
        <span className="text-xs font-semibold text-foreground dark:text-slate-300">{title}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.sessionId} className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <Link href={`/dashboard/calls/history?selectedSessionId=${item.sessionId}`}
                  className="block truncate text-sm font-medium text-foreground hover:text-primary dark:text-slate-300 dark:hover:text-cyan-300">
                  {item.guestPhone ?? item.sessionId.slice(0, 8)}
                </Link>
                {item.reason && (
                  <span className="block truncate text-xs text-muted-foreground">{item.reason}</span>
                )}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(item.occurredAt), { addSuffix: true, locale: ru })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
