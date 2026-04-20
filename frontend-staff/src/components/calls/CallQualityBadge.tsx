'use client';

import { cn } from '@/lib/utils';

interface CallQualityBadgeProps {
  /** AI state from socket events */
  aiState: string;
  /** Last detected intent */
  intent: string | null;
  /** Last confidence value 0–1 */
  confidence: number | null;
  /** Last turn latency in ms */
  latencyMs: number | null;
  /** Whether transcripts are still flowing (last segment < 30s ago) */
  transcriptFresh: boolean;
  className?: string;
}

function confidenceBucket(c: number): { label: string; color: string } {
  if (c >= 0.75) return { label: 'Высокая', color: 'text-green-700 bg-green-50' };
  if (c >= 0.5)  return { label: 'Средняя', color: 'text-yellow-700 bg-yellow-50' };
  return { label: 'Низкая', color: 'text-red-600 bg-red-50' };
}

function latencyBucket(ms: number): { label: string; color: string } {
  if (ms < 600)  return { label: `${ms}ms ⚡`, color: 'text-green-600' };
  if (ms < 1200) return { label: `${ms}ms`, color: 'text-yellow-600' };
  return { label: `${ms}ms ⚠`, color: 'text-red-500' };
}

const AI_STATE_META: Record<string, { label: string; dot: string }> = {
  ai_speaking:    { label: 'ИИ говорит',  dot: 'bg-teal-500 animate-pulse' },
  guest_speaking: { label: 'Гость говорит', dot: 'bg-blue-400 animate-pulse' },
  processing:     { label: 'Обработка…',  dot: 'bg-amber-400 animate-pulse' },
};

export function CallQualityBadge({
  aiState,
  intent,
  confidence,
  latencyMs,
  transcriptFresh,
  className,
}: CallQualityBadgeProps) {
  const stateMeta = AI_STATE_META[aiState];
  const confData = confidence !== null ? confidenceBucket(confidence) : null;
  const latData = latencyMs !== null ? latencyBucket(latencyMs) : null;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {/* AI state */}
      {stateMeta && (
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
          <span className={cn('h-2 w-2 rounded-full', stateMeta.dot)} />
          {stateMeta.label}
        </span>
      )}

      {/* Intent */}
      {intent && intent !== 'other' && (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
          {intent}
        </span>
      )}

      {/* Confidence */}
      {confData && (
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', confData.color)}>
          {confData.label}
        </span>
      )}

      {/* Latency */}
      {latData && (
        <span className={cn('text-[11px] font-mono font-medium', latData.color)}>
          {latData.label}
        </span>
      )}

      {/* Transcript freshness */}
      {!transcriptFresh && (
        <span className="text-[11px] text-slate-400 italic">транскрипт устарел</span>
      )}
    </div>
  );
}
