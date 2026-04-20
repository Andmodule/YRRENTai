'use client';

import { cn } from '@/lib/utils';
import type { CallSession } from '@/lib/api/calls';

interface ActiveCallsListProps {
  calls: CallSession[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}

const statusLabel: Record<string, string> = {
  ringing: 'Звонок',
  in_progress: 'Идёт',
  ai_handling: 'ИИ',
  handoff_pending: 'Ожидает',
  handed_off: 'Оператор',
  completed: 'Завершён',
  failed: 'Ошибка',
  no_answer: 'Нет ответа',
};

const statusColor: Record<string, string> = {
  ringing: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-teal-100 text-teal-700',
  ai_handling: 'bg-teal-100 text-teal-700',
  handoff_pending: 'bg-amber-100 text-amber-700',
  handed_off: 'bg-orange-100 text-orange-700',
  completed: 'bg-slate-100 text-slate-500',
  failed: 'bg-red-100 text-red-700',
  no_answer: 'bg-slate-100 text-slate-500',
};

function formatDuration(startedAt: string | null): string {
  if (!startedAt) return '—';
  const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ActiveCallsList({ calls, selectedId, onSelect, className }: ActiveCallsListProps) {
  if (calls.length === 0) {
    return (
      <div className={cn('flex items-center justify-center py-16 text-slate-400 text-sm', className)}>
        Активных звонков нет
      </div>
    );
  }

  return (
    <ul className={cn('flex flex-col gap-1 overflow-y-auto', className)}>
      {calls.map((call) => (
        <li key={call.id}>
          <button
            onClick={() => onSelect(call.id)}
            className={cn(
              'w-full rounded-xl px-3 py-3 text-left transition-colors',
              'hover:bg-slate-50 active:bg-slate-100',
              selectedId === call.id && 'bg-teal-50 ring-1 ring-teal-200',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-sm text-slate-800 truncate">
                {call.guestPhone ?? 'Неизвестный'}
              </span>
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                  statusColor[call.status] ?? 'bg-slate-100 text-slate-500',
                )}
              >
                {statusLabel[call.status] ?? call.status}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-3 text-xs text-slate-400">
              <span>{formatDuration(call.startedAt)}</span>
              {call.turnCount > 0 && <span>{call.turnCount} реплик</span>}
              {call.handoffStatus !== 'none' && (
                <span className="text-amber-500 font-medium">⚡ handoff</span>
              )}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
