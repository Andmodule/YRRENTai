'use client';

import { cn } from '@/lib/utils';
import { CheckCircle2, XCircle, Play, Loader2, Clock } from 'lucide-react';
import type { SmokeTestReport, SmokeTestStatus } from '@/lib/api/calls-admin';

interface Props {
  report?: SmokeTestReport;
  isRunning: boolean;
  onRun: () => void;
}

const STATUS_LABELS: Record<SmokeTestStatus, { label: string; color: string }> = {
  pass:    { label: 'Все тесты прошли', color: 'text-teal-400' },
  partial: { label: 'Частично прошли', color: 'text-amber-400' },
  fail:    { label: 'Тесты не прошли',  color: 'text-red-400' },
};

export function SmokeTestPanel({ report, isRunning, onRun }: Props) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/40 bg-slate-800/40">
        <span className="text-sm font-semibold text-slate-200">Smoke Tests</span>
        {report && (
          <span className={cn('text-xs font-medium', STATUS_LABELS[report.status].color)}>
            {STATUS_LABELS[report.status].label}
          </span>
        )}
      </div>

      <div className="p-4 space-y-4">
        <p className="text-xs text-slate-400">
          Внутренние тесты приложения без реальных звонков: оценка алертов, аудит, история, QA workload, rollout guard, stats endpoint.
        </p>

        <button
          onClick={onRun}
          disabled={isRunning}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            isRunning
              ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
              : 'bg-teal-600 hover:bg-teal-500 text-white',
          )}
        >
          {isRunning ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Выполняется…</>
          ) : (
            <><Play className="h-4 w-4" /> Запустить smoke tests</>
          )}
        </button>

        {report && (
          <div className="space-y-1.5 pt-1">
            {report.tests.map((test) => (
              <div
                key={test.key}
                className="flex items-start gap-3 px-3 py-2 rounded-lg bg-slate-800/40 border border-slate-700/30"
              >
                {test.status === 'pass' ? (
                  <CheckCircle2 className="h-4 w-4 text-teal-400 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200">{test.label}</p>
                  <p className="text-xs text-slate-400 mt-0.5 break-words">{test.message}</p>
                </div>
                <div className="flex items-center gap-1 text-xs text-slate-500 shrink-0">
                  <Clock className="h-3 w-3" />
                  {test.durationMs}ms
                </div>
              </div>
            ))}
            <div className="text-xs text-slate-500 pt-1">
              Старт: {new Date(report.startedAt).toLocaleTimeString()} ·
              Завершён: {new Date(report.finishedAt).toLocaleTimeString()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
