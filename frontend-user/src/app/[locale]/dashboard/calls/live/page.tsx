'use client';

import { useState } from 'react';
import { useActiveSessions, useCallSession } from '@/hooks/use-calls-admin';
import { takeoverSession } from '@/lib/api/calls-admin';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Radio, Phone, UserCheck, ArrowRightLeft, Search } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { SessionHistoryItem } from '@/lib/api/calls-admin';

// ── Session list item ─────────────────────────────────────────────────────────

function SessionRow({ session, isSelected, onSelect }: {
  session: SessionHistoryItem; isSelected: boolean; onSelect: () => void;
}) {
  const isActive = ['ringing', 'in_progress', 'ai_handling'].includes(session.status);
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors dark:border-slate-700/50',
        isSelected ? 'bg-primary/10 dark:bg-cyan-500/10' : 'hover:bg-muted/80 dark:hover:bg-slate-800/80',
      )}
    >
      <div className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
        isActive ? 'border border-teal-500/30 bg-teal-500/20' : 'bg-muted dark:bg-slate-700/60',
      )}>
        <Phone className={cn('h-4 w-4', isActive ? 'text-teal-600 dark:text-teal-400' : 'text-muted-foreground')} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-sm font-medium text-foreground dark:text-slate-200">
            {session.guestPhone ?? 'Неизвестный'}
          </span>
          {isActive && <span className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-pulse shrink-0" />}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>{session.provider} · {session.status}</span>
          {!session.propertyId && (
            <span className="text-amber-400/80">· объект?</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground dark:text-slate-600">
          {session.createdAt
            ? formatDistanceToNow(new Date(session.createdAt), { addSuffix: true, locale: ru })
            : '—'}
        </div>
      </div>
    </button>
  );
}

// ── Provider badge ────────────────────────────────────────────────────────────

function ProviderBadge({
  label, value, highlight,
}: { label: string; value: string; highlight?: 'teal' | 'amber' | 'red' }) {
  const color = {
    teal:  'text-teal-300 bg-teal-500/10 border-teal-500/20',
    amber: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
    red:   'text-red-300 bg-red-500/10 border-red-500/20',
  }[highlight ?? 'teal'] ??
    'border-border bg-muted/80 text-muted-foreground dark:border-slate-700/40 dark:bg-slate-700/30 dark:text-slate-400';
  return (
    <div className={cn('flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-mono', color)}>
      <span className="opacity-60">{label}:</span>
      <span>{value}</span>
    </div>
  );
}

// ── Session detail ────────────────────────────────────────────────────────────

function SessionDetail({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const { data: session } = useCallSession(sessionId);

  async function handleTakeover() {
    try {
      await takeoverSession(sessionId);
      toast.success('Управление перехвачено');
    } catch {
      toast.error('Ошибка перехвата');
    }
  }

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Skeleton className="h-40 w-80 bg-muted dark:bg-slate-800" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Mobile back */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 dark:border-slate-700/50 md:hidden">
        <button type="button" onClick={onBack} className="text-xs text-primary dark:text-cyan-400">
          ← Назад
        </button>
      </div>

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 dark:border-slate-700/50">
        <div>
          <div className="font-semibold text-foreground dark:text-slate-200">{session.guestPhone ?? 'Неизвестный'}</div>
          <div className="text-xs text-muted-foreground">
            {session.provider} · {session.status} · #{session.id.slice(0, 8)}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => void handleTakeover()}
            className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 transition-colors"
          >
            <UserCheck className="h-3.5 w-3.5" />
            Перехватить
          </button>
        </div>
      </div>

      {/* Session stats */}
      <div className="grid shrink-0 grid-cols-3 gap-3 border-b border-border px-4 py-3 dark:border-slate-700/50">
        {[
          { label: 'Реплики', value: session.turnCount },
          { label: 'Язык', value: session.language ?? '—' },
          { label: 'Avg latency', value: session.avgTurnLatencyMs ? `${session.avgTurnLatencyMs}ms` : '—' },
        ].map(({ label, value }) => (
          <div key={label} className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase text-muted-foreground">{label}</span>
            <span className="text-sm font-semibold text-foreground dark:text-slate-200">{value}</span>
          </div>
        ))}
      </div>

      {/* Retell / Provider context */}
      {session.provider === 'retell' && (
        <div className="flex shrink-0 flex-wrap gap-3 border-b border-border px-4 py-2.5 dark:border-slate-700/50">
          {session.guestPhone && (
            <ProviderBadge label="Гость" value={session.guestPhone} />
          )}

          {/* Property resolution state */}
          {!session.propertyId ? (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500/15 border border-amber-500/25 text-xs text-amber-300">
              <Search className="h-3 w-3 animate-pulse" />
              Определяется объект...
            </div>
          ) : (
            <ProviderBadge label="Объект" value={session.propertyId.slice(0, 8)} highlight="teal" />
          )}

          {session.handoffStatus && session.handoffStatus !== 'none' && (
            <ProviderBadge
              label="Handoff"
              value={session.handoffStatus}
              highlight={session.handoffStatus === 'completed' ? 'teal' : 'amber'}
            />
          )}
          {session.status === 'handed_off' && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500/15 border border-amber-500/25 text-xs text-amber-300">
              <ArrowRightLeft className="h-3 w-3" />
              Transfer активен
            </div>
          )}
        </div>
      )}

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase text-muted-foreground">Транскрипт</h3>
        {!session.transcript || session.transcript.length === 0 ? (
          <p className="text-sm text-muted-foreground">Транскрипт пуст или звонок ещё не начался</p>
        ) : (
          <div className="space-y-3">
            {session.transcript.map((seg) => (
              <div key={seg.id} className={cn(
                'flex gap-2 max-w-[85%]',
                seg.role === 'ai' ? 'mr-auto' : 'ml-auto flex-row-reverse',
              )}>
                <div className={cn(
                  'rounded-2xl px-3 py-2 text-sm',
                  seg.role === 'ai'
                    ? 'rounded-tl-sm bg-muted text-foreground dark:bg-slate-700/70 dark:text-slate-200'
                    : 'rounded-tr-sm border border-cyan-500/25 bg-cyan-500/15 text-cyan-900 dark:bg-cyan-500/20 dark:text-cyan-100 dark:border-cyan-500/20',
                )}>
                  {seg.content}
                  {seg.turnTotalMs && (
                    <span className="block text-[10px] opacity-50 mt-0.5">{seg.turnTotalMs}ms</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CallsLivePage() {
  const { data: sessions = [], isLoading } = useActiveSessions();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="flex h-[calc(100vh-10rem)] overflow-hidden rounded-xl border border-border bg-card dark:border-slate-700 dark:bg-slate-900">
      {/* Session list */}
      <aside className={cn(
        'flex flex-col border-r border-border dark:border-slate-700',
        selectedId ? 'hidden md:flex md:w-72' : 'flex w-full md:w-72',
      )}>
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3 dark:border-slate-700/50">
          <Radio className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          <span className="text-sm font-semibold text-foreground dark:text-slate-300">Live</span>
          {sessions.length > 0 && (
            <span className="ml-auto h-5 min-w-[1.25rem] rounded-full bg-teal-500/15 px-1.5 text-center text-[10px] font-bold leading-5 text-teal-800 ring-1 ring-teal-500/25 dark:bg-teal-500/20 dark:text-teal-300 dark:ring-teal-500/30">
              {sessions.length}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="p-3 space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl bg-muted dark:bg-slate-800" />)}
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-muted-foreground">
            <Radio className="h-8 w-8 opacity-30" />
            <span className="text-sm">Нет активных звонков</span>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {sessions.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                isSelected={s.id === selectedId}
                onSelect={() => setSelectedId(s.id)}
              />
            ))}
          </div>
        )}
      </aside>

      {/* Detail */}
      <main className={cn(
        'flex-1 min-w-0 flex flex-col',
        !selectedId && 'hidden md:flex md:items-center md:justify-center',
      )}>
        {selectedId ? (
          <SessionDetail sessionId={selectedId} onBack={() => setSelectedId(null)} />
        ) : (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <ArrowRightLeft className="h-8 w-8 opacity-20" />
            <span className="text-sm">Выберите звонок слева</span>
          </div>
        )}
      </main>
    </div>
  );
}
