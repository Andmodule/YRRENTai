'use client';

import { useMemo } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useSessionHistory } from '@/hooks/use-calls-admin';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { History, Filter, Download, X, ArrowRightLeft, ClipboardCheck, Phone } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { SessionHistoryItem } from '@/lib/api/calls-admin';
import { buildExportUrl } from '@/lib/api/calls-admin';

const PRESETS: Record<string, { label: string; params: Record<string, string> }> = {
  all:            { label: 'Все', params: {} },
  escalated:      { label: '⚡ Эскалация',   params: { handoffStatus: 'requested' } },
  handed_off:     { label: '🤝 Передан',     params: { status: 'handed_off' } },
  failed:         { label: '❌ Ошибка',      params: { status: 'failed' } },
  emergency:      { label: '🚨 Экстренный',  params: { hasQaFlag: 'emergency_detected' } },
  low_confidence: { label: '⚠ Низкая ув.',  params: { hasQaFlag: 'low_confidence' } },
};

const PAGE_SIZE = 25;

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-teal-500/15 text-teal-800 dark:bg-teal-500/20 dark:text-teal-300',
  handed_off: 'bg-amber-500/15 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  failed: 'bg-red-500/15 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  no_answer: 'bg-muted text-muted-foreground dark:bg-slate-600 dark:text-slate-300',
};

const HANDOFF_BADGES = {
  none: { label: 'AI only', color: 'text-muted-foreground dark:text-slate-500' },
  requested:  { label: '↗ Эскалация', color: 'text-amber-400' },
  in_progress:{ label: '⟳ Transfer',  color: 'text-amber-300' },
  completed:  { label: '✓ Transfer',  color: 'text-teal-400' },
} as const;

const PROVIDER_COLORS: Record<string, string> = {
  retell: 'bg-violet-500/15 text-violet-300 ring-violet-500/25',
  vapi:   'bg-blue-500/15 text-blue-300 ring-blue-500/25',
};

function useUrlParams() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const get = (key: string, def = '') => searchParams.get(key) ?? def;

  const set = (updates: Record<string, string | undefined>, replace = true) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (!v) params.delete(k); else params.set(k, v);
    }
    const url = `${pathname}?${params.toString()}`;
    replace ? router.replace(url) : router.push(url);
  };

  return { get, set };
}

type HandoffBadge = (typeof HANDOFF_BADGES)[keyof typeof HANDOFF_BADGES];

function resolveHandoff(status: string | undefined): HandoffBadge {
  if (!status || !(status in HANDOFF_BADGES)) return HANDOFF_BADGES.none;
  return HANDOFF_BADGES[status as keyof typeof HANDOFF_BADGES];
}

function HistoryRow({ session, isSelected, onSelect }: {
  session: SessionHistoryItem; isSelected: boolean; onSelect: () => void;
}) {
  const handoff = resolveHandoff(session.handoffStatus);
  const isHandoff = session.handoffStatus && session.handoffStatus !== 'none';
  const isFailed  = session.status === 'failed';

  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2.5 border-b border-border px-3 py-2.5 text-left text-sm transition-colors dark:border-slate-700/30',
        isSelected ? 'bg-primary/10 dark:bg-cyan-500/10' : 'hover:bg-muted/80 dark:hover:bg-slate-800/60',
      )}
    >
      {/* Provider icon */}
      <div className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg mt-0.5',
        isFailed ? 'bg-red-500/15' : isHandoff ? 'bg-amber-500/15' : 'bg-muted dark:bg-slate-700/60',
      )}>
        {isHandoff
          ? <ArrowRightLeft className={cn('h-3.5 w-3.5', handoff.color)} />
          : <Phone className={cn('h-3.5 w-3.5', isFailed ? 'text-red-500 dark:text-red-400' : 'text-muted-foreground')} />
        }
      </div>

      <div className="flex-1 min-w-0">
        {/* Top row: phone + status */}
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-xs font-medium text-foreground dark:text-slate-200">{session.guestPhone ?? '—'}</span>
          <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium', STATUS_COLORS[session.status] ?? 'bg-muted text-muted-foreground dark:bg-slate-700 dark:text-slate-400')}>
            {session.status}
          </span>
        </div>

        {/* Middle row: provider badge + handoff */}
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {/* Provider */}
          <span className={cn(
            'rounded-full px-1.5 py-px text-[10px] font-semibold ring-1',
            PROVIDER_COLORS[session.provider] ??
              'bg-muted/80 text-muted-foreground ring-border dark:bg-slate-700/40 dark:text-slate-400 dark:ring-slate-700/40',
          )}>
            {session.provider}
          </span>

          {/* Handoff outcome */}
          {isHandoff && (
            <span className={cn('text-[10px] font-medium', handoff.color)}>
              {handoff.label}
            </span>
          )}

          {/* Turns */}
          <span className="text-[10px] text-muted-foreground dark:text-slate-600">{session.turnCount} реплик</span>
        </div>

        {/* Time */}
        <div className="mt-0.5 text-[10px] text-muted-foreground dark:text-slate-600">
          {session.createdAt
            ? formatDistanceToNow(new Date(session.createdAt), { addSuffix: true, locale: ru })
            : '—'}
        </div>
      </div>
    </button>
  );
}

function SessionPanel({ session, onBack }: { session: SessionHistoryItem; onBack: () => void }) {
  const handoff = resolveHandoff(session.handoffStatus);
  const durationSec = session.endedAt && session.startedAt
    ? Math.round((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000)
    : null;

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 border-b border-border px-4 py-2 dark:border-slate-700/50 md:hidden">
        <button type="button" onClick={onBack} className="text-xs text-primary dark:text-cyan-400">
          ← Назад
        </button>
      </div>
      <div className="px-4 py-4 space-y-4 overflow-y-auto flex-1">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-foreground dark:text-slate-200">{session.guestPhone ?? 'Неизвестный'}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">#{session.id.slice(0, 8)}</p>
          </div>
          <div className="flex flex-wrap gap-1.5 justify-end">
            <span className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1',
              PROVIDER_COLORS[session.provider] ??
              'bg-muted/80 text-muted-foreground ring-border dark:bg-slate-700/40 dark:text-slate-400 dark:ring-slate-700/40',
            )}>
              {session.provider}
            </span>
            <span className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-semibold',
              STATUS_COLORS[session.status] ?? 'bg-muted text-muted-foreground dark:bg-slate-700 dark:text-slate-400',
            )}>
              {session.status}
            </span>
          </div>
        </div>

        {/* Handoff outcome banner */}
        {session.handoffStatus && session.handoffStatus !== 'none' && (
          <div className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-2 border text-xs',
            session.handoffStatus === 'completed'
              ? 'bg-teal-950/30 border-teal-700/30 text-teal-300'
              : 'bg-amber-950/30 border-amber-700/30 text-amber-300',
          )}>
            <ArrowRightLeft className="h-3.5 w-3.5 shrink-0" />
            <span>{handoff.label} — {session.handoffStatus}</span>
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2.5">
          {([
            ['Реплики',    String(session.turnCount)],
            ['Язык',       session.language ?? '—'],
            ['Avg latency', session.avgTurnLatencyMs ? `${session.avgTurnLatencyMs}ms` : '—'],
            ['Длительность', durationSec !== null ? `${durationSec}с` : '—'],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-border bg-muted/50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
              <div className="text-[10px] uppercase text-muted-foreground">{k}</div>
              <div className="text-sm font-semibold text-foreground dark:text-slate-200">{v}</div>
            </div>
          ))}
        </div>

        {/* Summary if present */}
        {session.summary && (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 dark:border-slate-700/60 dark:bg-slate-800/30">
            <div className="mb-1.5 flex items-center gap-1.5">
              <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-semibold uppercase text-muted-foreground">AI Summary</span>
            </div>
            <p className="text-xs leading-relaxed text-foreground/90 dark:text-slate-300">{session.summary}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CallsHistoryPage() {
  const { get, set } = useUrlParams();

  const preset = get('preset', 'all');
  const page = Number(get('page', '0'));
  const selectedId = get('selectedSessionId');
  const search = get('search');
  const provider = get('provider');
  const dateFrom = get('dateFrom');
  const dateTo = get('dateTo');

  const presetParams = PRESETS[preset]?.params ?? {};
  const queryParams = useMemo(() => ({
    ...presetParams,
    search: search || undefined,
    provider: provider || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [presetParams, search, provider, dateFrom, dateTo, page]);

  const { data, isLoading } = useSessionHistory(queryParams);
  const sessions = data?.sessions ?? [];
  const total = data?.total ?? 0;

  const selectedSession = sessions.find((s) => s.id === selectedId) ?? null;

  const exportUrl = buildExportUrl('history', {
    ...presetParams as Record<string, string>,
    provider: provider || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  return (
    <div className="flex h-[calc(100vh-10rem)] overflow-hidden rounded-xl border border-border bg-card dark:border-slate-700 dark:bg-slate-900">
      {/* List panel */}
      <aside className={cn(
        'flex flex-col border-r border-border dark:border-slate-700',
        selectedId ? 'hidden md:flex md:w-72' : 'flex w-full md:w-72',
      )}>
        {/* Subheader */}
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2 dark:border-slate-700/50">
          <History className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground">История</span>
          {total > 0 && <span className="ml-1 text-xs text-muted-foreground">{total}</span>}
          <a href={exportUrl} download className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-primary dark:hover:text-cyan-400">
            <Download className="h-3 w-3" />
          </a>
        </div>

        {/* Presets */}
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5 dark:border-slate-700/30">
          {Object.entries(PRESETS).map(([key, meta]) => (
            <button key={key} onClick={() => set({ preset: key, page: '0', selectedSessionId: '' })}
              className={cn('shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors',
                preset === key ? 'bg-primary/15 text-primary ring-1 ring-primary/25 dark:bg-cyan-500/20 dark:text-cyan-300 dark:ring-cyan-500/30' : 'bg-muted text-muted-foreground hover:bg-accent dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700')}>
              {meta.label}
            </button>
          ))}
        </div>

        {/* Filter row */}
        <div className="flex shrink-0 gap-1.5 border-b border-border px-2 py-1.5 dark:border-slate-700/30">
          <div className="relative flex-1">
            <Filter className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <input type="search" placeholder="Номер…" value={search}
              onChange={(e) => set({ search: e.target.value || undefined, page: '0' })}
              className="h-6 w-full rounded-lg border border-input bg-input-fill pl-6 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200" />
          </div>
          <select value={provider} onChange={(e) => set({ provider: e.target.value || undefined, page: '0' })}
            className="h-6 rounded-lg border border-input bg-input-fill px-1.5 text-[10px] text-muted-foreground focus:outline-none dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
            <option value="">Провайдер</option>
            <option value="retell">Retell</option>
            <option value="vapi">Vapi</option>
          </select>
          {(search || provider || dateFrom) && (
            <button onClick={() => set({ search: '', provider: '', dateFrom: '', dateTo: '' })}
              className="text-muted-foreground hover:text-destructive dark:hover:text-red-400">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="p-2 space-y-1">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 rounded-xl bg-muted dark:bg-slate-800" />)}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {sessions.map((s) => (
              <HistoryRow key={s.id} session={s} isSelected={s.id === selectedId}
                onSelect={() => set({ selectedSessionId: s.id }, true)} />
            ))}
            {sessions.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">Нет звонков</div>
            )}
          </div>
        )}

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground dark:border-slate-700/50">
            <button disabled={page === 0} onClick={() => set({ page: String(page - 1) })} className="disabled:opacity-40">← Назад</button>
            <span>{page + 1} / {Math.ceil(total / PAGE_SIZE)}</span>
            <button disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => set({ page: String(page + 1) })} className="disabled:opacity-40">Далее →</button>
          </div>
        )}
      </aside>

      {/* Detail */}
      <main className={cn(
        'flex-1 min-w-0',
        !selectedId && 'hidden md:flex md:items-center md:justify-center',
      )}>
        {selectedSession ? (
          <SessionPanel session={selectedSession} onBack={() => set({ selectedSessionId: '' })} />
        ) : (
          <span className="text-sm text-muted-foreground">Выберите звонок</span>
        )}
      </main>
    </div>
  );
}
