'use client';

import { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { TranscriptSegment } from '@/lib/api/calls';

interface TranscriptTimelineProps {
  segments: TranscriptSegment[];
  className?: string;
}

const roleLabel: Record<string, string> = {
  guest: 'Гость',
  ai: 'ИИ',
  operator: 'Оператор',
};

const roleColors: Record<string, string> = {
  guest: 'bg-slate-100 text-slate-800 self-start',
  ai: 'bg-teal-50 text-teal-900 self-end border border-teal-200',
  operator: 'bg-amber-50 text-amber-900 self-end border border-amber-200',
};

export function TranscriptTimeline({ segments, className }: TranscriptTimelineProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [segments.length]);

  if (segments.length === 0) {
    return (
      <div className={cn('flex items-center justify-center py-12 text-slate-400 text-sm', className)}>
        Транскрипт пуст
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-2 overflow-y-auto px-3 py-3', className)}>
      {segments.map((seg) => (
        <div key={seg.id} className={cn('flex flex-col max-w-[85%] gap-0.5', seg.role !== 'guest' && 'self-end')}>
          <div className="flex items-center gap-2 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {roleLabel[seg.role] ?? seg.role}
            </span>
            {seg.intent && (
              <span className="text-[10px] bg-slate-200 text-slate-600 rounded px-1.5 py-0.5">
                {seg.intent}
              </span>
            )}
            {seg.confidence !== null && seg.confidence !== undefined && seg.role === 'ai' && (
              <span
                className={cn(
                  'text-[10px] rounded px-1.5 py-0.5',
                  seg.confidence >= 0.7 ? 'bg-green-100 text-green-700' :
                  seg.confidence >= 0.45 ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700',
                )}
              >
                {Math.round(seg.confidence * 100)}%
              </span>
            )}
            {seg.triggeredEscalation && (
              <span className="text-[10px] bg-red-100 text-red-600 rounded px-1.5 py-0.5 font-medium">
                ⚠ Эскалация
              </span>
            )}
          </div>
          <div className={cn('rounded-2xl px-3 py-2 text-sm leading-snug', roleColors[seg.role] ?? 'bg-slate-100')}>
            {seg.content}
          </div>
          {seg.kbSources && seg.kbSources.length > 0 && (
            <div className="px-1 text-[10px] text-slate-400">
              KB: {seg.kbSources.length} источник(а)
            </div>
          )}
          {seg.latencyMs !== null && seg.latencyMs !== undefined && seg.role === 'ai' && (
            <div className="px-1 text-[10px] text-slate-400">{seg.latencyMs}ms</div>
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
