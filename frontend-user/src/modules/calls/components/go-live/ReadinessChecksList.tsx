'use client';

import { cn } from '@/lib/utils';
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { GoLiveReadiness, ReadinessCheck } from '@/lib/api/calls-admin';

// ── Check row ─────────────────────────────────────────────────────────────────

function CheckRow({ check }: { check: ReadinessCheck }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = check.status === 'pass' ? CheckCircle2 : check.status === 'warn' ? AlertTriangle : XCircle;
  const iconColor = { pass: 'text-teal-400', warn: 'text-amber-400', fail: 'text-red-400' }[check.status];
  const badgeColor = {
    pass: 'bg-teal-500/15 text-teal-300 ring-teal-500/25',
    warn: 'bg-amber-500/15 text-amber-300 ring-amber-500/25',
    fail: 'bg-red-500/15 text-red-300 ring-red-500/25',
  }[check.status];

  return (
    <div className="space-y-1">
      <button
        onClick={() => check.details && setExpanded((v) => !v)}
        className={cn(
          'w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
          check.details ? 'hover:bg-slate-800/40 cursor-pointer' : 'cursor-default',
        )}
      >
        <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', iconColor)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-200">{check.label}</span>
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide ring-1', badgeColor)}>
              {check.status}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{check.message}</p>
        </div>
        {check.details && (
          <ChevronDown className={cn('h-3.5 w-3.5 text-slate-500 shrink-0 mt-0.5 transition-transform', expanded && 'rotate-180')} />
        )}
      </button>
      {expanded && check.details && (
        <div className="ml-10 mr-3 mb-1 px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/40 text-xs text-slate-400">
          {check.details}
        </div>
      )}
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

interface SectionConfig {
  title: string;
  keys: string[];
}

const SECTIONS: SectionConfig[] = [
  { title: 'Environment', keys: ['env_provider_api_key', 'env_webhook_secret', 'env_ff_voice', 'env_did_map'] },
  { title: 'Retell Config', keys: ['env_retell_agent_id', 'env_retell_inbound_number', 'env_public_backend_url'] },
  { title: 'Provider',    keys: ['provider_configured'] },
  { title: 'Webhook',     keys: ['webhook_secret'] },
  { title: 'Handoff',     keys: ['handoff_transfer_number', 'handoff_did_map'] },
  { title: 'Rollout',     keys: ['rollout_cohorts', 'rollout_enabled'] },
  { title: 'Alerts',      keys: ['alerts_coverage'] },
  { title: 'QA',          keys: ['qa_backlog'] },
];

interface Props {
  readiness: GoLiveReadiness;
}

export function ReadinessChecksList({ readiness }: Props) {
  const checkMap = new Map(readiness.checks.map((c) => [c.key, c]));

  return (
    <div className="space-y-4">
      {SECTIONS.map((section) => {
        const checks = section.keys
          .map((k) => checkMap.get(k))
          .filter((c): c is ReadinessCheck => c !== undefined);

        // Also show any checks not in predefined sections
        if (checks.length === 0) return null;

        const sectionStatus = checks.some((c) => c.status === 'fail')
          ? 'fail'
          : checks.some((c) => c.status === 'warn')
            ? 'warn'
            : 'pass';

        const sectionDot = {
          pass: 'bg-teal-400',
          warn: 'bg-amber-400',
          fail: 'bg-red-400',
        }[sectionStatus];

        return (
          <div key={section.title} className="rounded-xl border border-slate-700/50 bg-slate-900/40 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/40 bg-slate-800/40">
              <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', sectionDot)} />
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">{section.title}</span>
            </div>
            <div className="divide-y divide-slate-800/40">
              {checks.map((c) => <CheckRow key={c.key} check={c} />)}
            </div>
          </div>
        );
      })}

      {/* Catch-all for checks not in predefined sections */}
      {(() => {
        const definedKeys = new Set(SECTIONS.flatMap((s) => s.keys));
        const extra = readiness.checks.filter((c) => !definedKeys.has(c.key));
        if (extra.length === 0) return null;
        return (
          <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-700/40 bg-slate-800/40">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Other</span>
            </div>
            <div className="divide-y divide-slate-800/40">
              {extra.map((c) => <CheckRow key={c.key} check={c} />)}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
