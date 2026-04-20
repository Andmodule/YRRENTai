'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOverviewStats, useOverviewTrends } from '@/hooks/use-calls-stats';
import { KpiCard } from '@/components/calls/overview/KpiCard';
import { PropertyRolloutWidget } from '@/components/calls/overview/PropertyRolloutWidget';
import { AlertsFeed } from '@/components/calls/overview/AlertsFeed';
import { SystemHealthGrid } from '@/components/calls/overview/SystemHealthGrid';
import { Sparkline } from '@/components/calls/overview/Sparkline';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Radio, PhoneCall, Zap, ArrowRightLeft,
  ShieldAlert, TrendingDown, Timer, ClipboardCheck, RefreshCw, Activity,
} from 'lucide-react';

type Range = 'today' | '7d' | '30d';

const RANGE_OPTIONS: Array<{ key: Range; label: string }> = [
  { key: 'today', label: 'Сегодня' },
  { key: '7d',   label: '7 дней' },
  { key: '30d',  label: '30 дней' },
];

export default function CallsOverviewPage() {
  const router = useRouter();
  const [range, setRange] = useState<Range>('today');

  const { data: stats, isLoading, refetch } = useOverviewStats();
  const { data: trends } = useOverviewTrends(range);

  // Extract sparkline series from trends
  const trendPts = trends?.points ?? [];
  const callsSeries = trendPts.map((p) => p.callsCompleted);
  const escalSeries = trendPts.map((p) => p.escalationRate);
  const p50Series   = trendPts.map((p) => p.p50TurnLatencyMs);

  return (
    <div className="flex flex-col gap-5 p-5 max-w-6xl pb-10">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-base font-bold text-slate-800">Обзор звонков</h1>
          <p className="text-xs text-slate-400 mt-0.5">Обновляется каждые 15 с</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Range switcher */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
            {RANGE_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setRange(key)}
                className={cn(
                  'px-3 py-1.5 transition-colors',
                  range === key
                    ? 'bg-teal-600 text-white'
                    : 'bg-white text-slate-500 hover:bg-slate-50',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => void refetch()} className="gap-1.5 text-slate-400 text-xs h-8">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* KPI row 1 — live + today */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Активных сейчас"
          value={stats?.activeSessions}
          icon={Radio}
          color={stats?.activeSessions ? 'teal' : 'default'}
          isLoading={isLoading}
          pulse={!!stats?.activeSessions}
          onClick={() => router.push('/calls/live')}
        />
        <KpiCard
          label="Звонков сегодня"
          value={stats?.callsToday}
          icon={PhoneCall}
          isLoading={isLoading}
          sparkline={<Sparkline values={callsSeries} color="teal" />}
        />
        <KpiCard
          label="Эскалировано"
          value={stats?.escalatedPct !== undefined ? `${stats.escalatedPct}%` : null}
          icon={Zap}
          color={stats?.escalatedPct && stats.escalatedPct > 20 ? 'amber' : 'default'}
          isLoading={isLoading}
          sparkline={<Sparkline values={escalSeries} color={stats?.escalatedPct && stats.escalatedPct > 20 ? 'amber' : 'teal'} />}
          onClick={() => router.push('/calls/history?preset=escalated')}
        />
        <KpiCard
          label="Handoff"
          value={stats?.handoffPct !== undefined ? `${stats.handoffPct}%` : null}
          icon={ArrowRightLeft}
          isLoading={isLoading}
          onClick={() => router.push('/calls/history?preset=handed_off')}
        />
      </div>

      {/* KPI row 2 — quality + latency */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <KpiCard
          label="Fallback rate"
          value={stats?.fallbackPct !== undefined ? `${stats.fallbackPct}%` : null}
          icon={ShieldAlert}
          color={stats?.fallbackPct && stats.fallbackPct > 15 ? 'amber' : 'slate'}
          isLoading={isLoading}
          onClick={() => router.push('/calls/history?preset=failed')}
        />
        <KpiCard
          label="Низкая ув."
          value={stats?.lowConfidencePct !== undefined ? `${stats.lowConfidencePct}%` : null}
          icon={TrendingDown}
          color={stats?.lowConfidencePct && stats.lowConfidencePct > 25 ? 'red' : 'slate'}
          isLoading={isLoading}
          onClick={() => router.push('/calls/history?preset=low_confidence')}
        />
        <KpiCard
          label="p50 latency"
          value={stats?.p50TurnLatencyMs !== null ? `${stats?.p50TurnLatencyMs}ms` : null}
          icon={Timer}
          color={stats?.p50TurnLatencyMs && stats.p50TurnLatencyMs > 1000 ? 'amber' : 'slate'}
          isLoading={isLoading}
          sparkline={<Sparkline values={p50Series} color={stats?.p50TurnLatencyMs && stats.p50TurnLatencyMs > 1000 ? 'amber' : 'slate'} />}
        />
        <KpiCard
          label="p95 latency"
          value={stats?.p95TurnLatencyMs !== null ? `${stats?.p95TurnLatencyMs}ms` : null}
          icon={Timer}
          color={stats?.p95TurnLatencyMs && stats.p95TurnLatencyMs > 2000 ? 'red' : 'slate'}
          isLoading={isLoading}
        />
        <KpiCard
          label="QA очередь"
          value={stats?.pendingReviewsCount}
          icon={ClipboardCheck}
          color={stats?.pendingReviewsCount && stats.pendingReviewsCount > 5 ? 'amber' : 'slate'}
          isLoading={isLoading}
          onClick={() => router.push('/calls/qa?reviewStatus=open')}
        />
      </div>

      {/* Quick actions */}
      {stats && (stats.activeSessions > 0 || stats.pendingReviewsCount > 0) && (
        <div className="flex flex-wrap gap-2">
          {stats.activeSessions > 0 && (
            <Button size="sm" className="bg-teal-600 hover:bg-teal-700 text-white gap-1.5" onClick={() => router.push('/calls/live')}>
              <Radio className="h-3.5 w-3.5" />
              Live ({stats.activeSessions})
            </Button>
          )}
          {stats.pendingReviewsCount > 0 && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => router.push('/calls/qa?reviewStatus=open')}>
              <ClipboardCheck className="h-3.5 w-3.5" />
              QA Queue ({stats.pendingReviewsCount})
            </Button>
          )}
        </div>
      )}

      {/* System health */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <Activity className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">System Health</span>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-[10px] font-medium ml-2">
            {(['24h', '7d'] as const).map((r) => (
              <button
                key={r}
                className="px-2 py-0.5 bg-white text-slate-400 hover:bg-slate-50"
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <SystemHealthGrid />
      </section>

      {/* Bottom: alerts + rollout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <AlertsFeed
            title="Последние эскалации (24ч)"
            items={stats?.recentEscalations ?? []}
            icon="escalation"
            emptyText="Эскалаций не было"
          />
          <AlertsFeed
            title="Неудачные трансферы (24ч)"
            items={stats?.recentFailedTransfers ?? []}
            icon="transfer"
            emptyText="Неудачных трансферов не было"
          />
        </div>
        <PropertyRolloutWidget />
      </div>
    </div>
  );
}
