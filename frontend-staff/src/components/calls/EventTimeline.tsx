'use client';

import { cn } from '@/lib/utils';

export interface CallEvent {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  latencyMs: number | null;
  createdAt: string;
}

interface EventTimelineProps {
  events: CallEvent[];
  className?: string;
}

const EVENT_ICONS: Record<string, string> = {
  session_created:      '🔵',
  session_started:      '🟢',
  session_ended:        '⚫',
  intent_detected:      '🎯',
  policy_decision:      '⚖️',
  escalation_requested: '⚡',
  emergency_guard:      '🚨',
  handoff_started:      '🤝',
  handoff_completed:    '✅',
  operator_takeover:    '👤',
  fallback_triggered:   '🔄',
  error:                '❌',
  provider_webhook:     '📡',
  ai_turn_start:        '🤖',
  ai_turn_end:          '💬',
};

const EVENT_COLORS: Record<string, string> = {
  emergency_guard:      'text-red-600 bg-red-50',
  escalation_requested: 'text-amber-700 bg-amber-50',
  handoff_started:      'text-orange-700 bg-orange-50',
  handoff_completed:    'text-green-700 bg-green-50',
  operator_takeover:    'text-blue-700 bg-blue-50',
  fallback_triggered:   'text-yellow-700 bg-yellow-50',
  error:                'text-red-700 bg-red-50',
  session_ended:        'text-slate-500 bg-slate-50',
};

function formatEventType(type: string): string {
  return type.replace(/_/g, ' ');
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderPayloadSummary(type: string, payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  switch (type) {
    case 'intent_detected':
      return `intent: ${String(payload['intent'] ?? '?')} · conf: ${
        typeof payload['confidence'] === 'number' ? `${Math.round((payload['confidence'] as number) * 100)}%` : '?'
      }`;
    case 'escalation_requested':
      return `reason: ${String(payload['reason'] ?? '?')}`;
    case 'emergency_guard':
      return `decision: ${String(payload['decision'] ?? '?')}`;
    case 'fallback_triggered':
      return `reason: ${String(payload['reason'] ?? '?')}`;
    case 'handoff_started':
    case 'handoff_completed':
      return `mode: ${String(payload['mode'] ?? '?')}`;
    case 'operator_takeover':
      return `userId: ${String(payload['userId'] ?? '?').slice(0, 8)}…`;
    default:
      return null;
  }
}

export function EventTimeline({ events, className }: EventTimelineProps) {
  if (events.length === 0) {
    return (
      <div className={cn('py-6 text-center text-xs text-slate-400', className)}>
        Нет событий
      </div>
    );
  }

  return (
    <ol className={cn('flex flex-col gap-0', className)}>
      {events.map((ev, idx) => {
        const icon = EVENT_ICONS[ev.type] ?? '•';
        const colorClass = EVENT_COLORS[ev.type] ?? 'text-slate-600 bg-white';
        const summary = renderPayloadSummary(ev.type, ev.payload);
        const isLast = idx === events.length - 1;

        return (
          <li key={ev.id} className="flex gap-2 group">
            {/* Timeline connector */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px]',
                  colorClass,
                )}
              >
                {icon}
              </div>
              {!isLast && <div className="w-px flex-1 bg-slate-100 my-0.5" />}
            </div>

            {/* Content */}
            <div className="pb-3 pt-0.5 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={cn(
                    'text-[11px] font-semibold capitalize',
                    colorClass.split(' ')[0],
                  )}
                >
                  {formatEventType(ev.type)}
                </span>
                {ev.latencyMs !== null && ev.latencyMs !== undefined && (
                  <span className="text-[10px] text-slate-400">{ev.latencyMs}ms</span>
                )}
                <span className="text-[10px] text-slate-300 ml-auto shrink-0">
                  {formatTime(ev.createdAt)}
                </span>
              </div>
              {summary && (
                <div className="text-[11px] text-slate-500 mt-0.5 truncate">{summary}</div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
