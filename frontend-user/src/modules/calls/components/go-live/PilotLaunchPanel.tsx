'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowRight, Radio, ClipboardCheck, Layers, Bell } from 'lucide-react';
import type { GoLiveReadiness } from '@/lib/api/calls-admin';

interface Props {
  readiness: GoLiveReadiness;
}

interface Warning {
  key: string;
  message: string;
}

export function PilotLaunchPanel({ readiness }: Props) {
  const params = useParams();
  const locale = (params?.locale as string) ?? 'ru';
  const base = `/${locale}/dashboard/calls`;

  const warnings: Warning[] = [];

  if (readiness.rollout.pilotCount === 0) {
    warnings.push({ key: 'no_pilot', message: 'Нет объектов в cohort pilot — добавьте минимум один для старта' });
  }
  if (!readiness.handoff.transferNumberPresent) {
    warnings.push({ key: 'no_handoff', message: 'HANDOFF_TRANSFER_NUMBER не задан — перевод на оператора не сработает' });
  }
  if (!readiness.alerts.hasDefaultCriticalCoverage) {
    warnings.push({ key: 'no_alerts', message: 'Не все критичные метрики покрыты алерт-правилами' });
  }
  if (readiness.qa.unassignedOpenReviewsCount > 5) {
    warnings.push({ key: 'qa_backlog', message: `${readiness.qa.unassignedOpenReviewsCount} неназначенных QA reviews — назначьте ревьюеров` });
  }
  if (!readiness.env.voiceFeatureFlagEnabled) {
    warnings.push({ key: 'ff_off', message: 'FF_VOICE_ENABLED=false — голосовой AI выключен глобально' });
  }

  const quickLinks = [
    { href: `${base}/rollout`, label: 'Rollout', icon: Layers, desc: 'Управление cohort' },
    { href: `${base}/overview`, label: 'Алерты', icon: Bell, desc: 'Мониторинг' },
    { href: `${base}/live`, label: 'Live', icon: Radio, desc: 'Активные звонки' },
    { href: `${base}/qa`, label: 'QA', icon: ClipboardCheck, desc: 'Review queue' },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card/90 dark:border-slate-700/50 dark:bg-slate-900/40">
      <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-4 py-3 dark:border-slate-700/40 dark:bg-slate-800/40">
        <span className="text-sm font-semibold text-foreground dark:text-slate-200">Pilot Launch</span>
      </div>

      <div className="p-4 space-y-4">
        {/* Cohort summary */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <CohortStat label="Pilot"    count={readiness.rollout.pilotCount}   color="teal" />
          <CohortStat label="Beta"     count={readiness.rollout.betaCount}    color="blue" />
          <CohortStat label="Stable"   count={readiness.rollout.stableCount}  color="purple" />
          <CohortStat label="Enabled"  count={readiness.rollout.enabledPropertiesCount} color="green" />
        </div>

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="space-y-1.5">
            {warnings.map((w) => (
              <div key={w.key} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-950/30 border border-amber-700/30">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300">{w.message}</p>
              </div>
            ))}
          </div>
        )}

        {/* Quick links */}
        <div className="space-y-1.5 pt-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground dark:text-slate-400">Быстрый доступ</p>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {quickLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors',
                    'border-border bg-muted/50 hover:border-border hover:bg-muted dark:border-slate-700/40 dark:bg-slate-800/30 dark:hover:border-slate-600/60 dark:hover:bg-slate-800/70',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground dark:text-slate-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground dark:text-slate-200">{link.label}</p>
                    <p className="text-xs text-muted-foreground dark:text-slate-500">{link.desc}</p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground dark:text-slate-600" />
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function CohortStat({ label, count, color }: { label: string; count: number; color: string }) {
  const colorMap: Record<string, string> = {
    teal:   'bg-teal-500/10 border-teal-700/30 text-teal-300',
    blue:   'bg-blue-500/10 border-blue-700/30 text-blue-300',
    purple: 'bg-purple-500/10 border-purple-700/30 text-purple-300',
    green:  'bg-emerald-500/10 border-emerald-700/30 text-emerald-300',
  };
  return (
    <div className={cn('px-3 py-2.5 rounded-lg border text-center', colorMap[color] ?? colorMap['teal'])}>
      <p className="text-xl font-bold">{count}</p>
      <p className="text-xs font-medium opacity-80 mt-0.5">{label}</p>
    </div>
  );
}
