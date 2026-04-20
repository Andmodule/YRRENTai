'use client';

import { useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ActiveCallsList } from '@/components/calls/ActiveCallsList';
import { CallLivePanel } from '@/components/calls/CallLivePanel';
import { fetchCallHistory } from '@/lib/api/call-review';
import { buildExportUrl } from '@/lib/api/calls-stats';
import { useUrlState } from '@/hooks/use-url-state';
import { Filter, Download, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Filter definitions ────────────────────────────────────────────────────────

const PRESET_META: Record<string, { label: string; color: string; params: Record<string, string> }> = {
  all:            { label: 'Все',           color: 'bg-slate-100 text-slate-700', params: {} },
  escalated:      { label: '⚡ Эскалация',  color: 'bg-amber-50 text-amber-700 border border-amber-200', params: { handoffStatus: 'requested' } },
  handed_off:     { label: '🤝 Передан',    color: 'bg-orange-50 text-orange-700 border border-orange-200', params: { status: 'handed_off' } },
  failed:         { label: '❌ Ошибка',     color: 'bg-red-50 text-red-700 border border-red-200', params: { status: 'failed' } },
  emergency:      { label: '🚨 Экстренный', color: 'bg-red-100 text-red-800 border border-red-300', params: { hasQaFlag: 'emergency_detected' } },
  low_confidence: { label: '⚠ Низкая ув.', color: 'bg-yellow-50 text-yellow-700 border border-yellow-200', params: { hasQaFlag: 'low_confidence' } },
  needs_qa:       { label: '📋 Нужен QA',  color: 'bg-purple-50 text-purple-700 border border-purple-200', params: { hasQaFlag: 'unresolved_question' } },
};

const PAGE_SIZE = 25;

type HistoryUrlState = {
  preset: string;
  page: string;
  selectedSessionId: string;
  activeTab: string;
  propertyId: string;
  provider: string;
  dateFrom: string;
  dateTo: string;
  search: string;
};

const DEFAULTS: HistoryUrlState = {
  preset: 'all',
  page: '0',
  selectedSessionId: '',
  activeTab: 'transcript',
  propertyId: '',
  provider: '',
  dateFrom: '',
  dateTo: '',
  search: '',
};

export default function CallsHistoryPage() {
  const [state, setState] = useUrlState<HistoryUrlState>(DEFAULTS);

  const page = Number(state.page) || 0;
  const preset = state.preset || 'all';
  const presetMeta = PRESET_META[preset] ?? PRESET_META['all']!;

  const queryParams = useMemo(() => {
    const base: Record<string, string | undefined> = {
      ...presetMeta.params,
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    };
    if (state.propertyId) base.propertyId = state.propertyId;
    if (state.provider)   base.provider   = state.provider;
    if (state.dateFrom)   base.dateFrom   = state.dateFrom;
    if (state.dateTo)     base.dateTo     = state.dateTo;
    if (state.search)     base.search     = state.search;
    return base;
  }, [presetMeta.params, page, state]);

  const { data, isLoading } = useQuery({
    queryKey: ['call-history', queryParams],
    queryFn: () => fetchCallHistory(queryParams as Parameters<typeof fetchCallHistory>[0]),
    staleTime: 30_000,
  });

  const sessions = data?.sessions ?? [];
  const total    = data?.total ?? 0;

  const select = useCallback((id: string | null) => {
    setState({ selectedSessionId: id ?? '' }, { replace: true });
  }, [setState]);

  const handlePreset = useCallback((p: string) => {
    setState({ preset: p, page: '0', selectedSessionId: '' }, { replace: true });
  }, [setState]);

  const exportUrl = buildExportUrl('history', {
    ...presetMeta.params as Record<string, string | undefined>,
    propertyId: state.propertyId || undefined,
    provider: state.provider || undefined,
    dateFrom: state.dateFrom || undefined,
    dateTo: state.dateTo || undefined,
  });

  const hasActiveFilters = state.propertyId || state.provider || state.dateFrom || state.search;

  return (
    <div className="flex flex-col h-full">
      {/* Subheader */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-200 bg-white shrink-0 flex-wrap">
        <Filter className="h-4 w-4 text-slate-400 shrink-0" />
        <span className="text-sm font-semibold text-slate-700 shrink-0">История</span>
        {total > 0 && <span className="text-xs text-slate-400">{total}</span>}

        {/* Preset chips */}
        <div className="flex gap-1 overflow-x-auto ml-2">
          {Object.entries(PRESET_META).map(([key, meta]) => (
            <button
              key={key}
              onClick={() => handlePreset(key)}
              className={cn(
                'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium transition-all',
                preset === key
                  ? `${meta.color} ring-1 ring-current`
                  : 'bg-slate-50 text-slate-500 hover:bg-slate-100',
              )}
            >
              {meta.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <a
            href={exportUrl}
            download
            className="flex items-center gap-1 h-7 px-2 rounded-lg text-xs text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <Download className="h-3 w-3" />
            CSV
          </a>
        </div>
      </div>

      {/* Advanced filters row */}
      <div className="flex flex-wrap gap-2 px-4 py-2 bg-slate-50 border-b border-slate-100 shrink-0">
        <input
          type="search"
          placeholder="Поиск по номеру…"
          value={state.search}
          onChange={(e) => setState({ search: e.target.value, page: '0' }, { replace: true })}
          className="h-7 rounded-lg border border-slate-200 px-2 text-xs w-36 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
        <select
          value={state.provider}
          onChange={(e) => setState({ provider: e.target.value, page: '0' }, { replace: true })}
          className="h-7 rounded-lg border border-slate-200 px-2 text-xs text-slate-600 focus:outline-none"
        >
          <option value="">Провайдер: все</option>
          <option value="retell">Retell</option>
          <option value="vapi">Vapi</option>
          <option value="twilio">Twilio</option>
        </select>
        <input
          type="date"
          value={state.dateFrom}
          onChange={(e) => setState({ dateFrom: e.target.value, page: '0' }, { replace: true })}
          className="h-7 rounded-lg border border-slate-200 px-2 text-xs text-slate-600 focus:outline-none"
        />
        <span className="text-xs text-slate-400 self-center">—</span>
        <input
          type="date"
          value={state.dateTo}
          onChange={(e) => setState({ dateTo: e.target.value, page: '0' }, { replace: true })}
          className="h-7 rounded-lg border border-slate-200 px-2 text-xs text-slate-600 focus:outline-none"
        />
        {hasActiveFilters && (
          <button
            onClick={() => setState({ search: '', provider: '', dateFrom: '', dateTo: '', propertyId: '' }, { replace: true })}
            className="h-7 px-2 rounded-lg text-xs text-red-500 hover:bg-red-50 flex items-center gap-1"
          >
            <X className="h-3 w-3" />
            Сбросить
          </button>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Session list — stacked on mobile */}
        <aside className={cn(
          'bg-white border-r border-slate-200 flex flex-col',
          state.selectedSessionId ? 'hidden md:flex md:w-64' : 'flex w-full md:w-64',
        )}>
          {isLoading ? (
            <div className="flex flex-col gap-2 p-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
            </div>
          ) : (
            <>
              <ActiveCallsList
                calls={sessions}
                selectedId={state.selectedSessionId || null}
                onSelect={select}
                className="flex-1 p-2"
              />
              {total > PAGE_SIZE && (
                <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 text-xs text-slate-500 shrink-0">
                  <button disabled={page === 0} onClick={() => setState({ page: String(page - 1) }, { replace: true })} className="disabled:opacity-40">← Назад</button>
                  <span>{page + 1} / {Math.ceil(total / PAGE_SIZE)}</span>
                  <button disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setState({ page: String(page + 1) }, { replace: true })} className="disabled:opacity-40">Далее →</button>
                </div>
              )}
            </>
          )}
        </aside>

        {/* Detail panel */}
        <main className={cn(
          'bg-white flex-1 min-w-0',
          !state.selectedSessionId && 'hidden md:flex md:items-center md:justify-center',
        )}>
          {state.selectedSessionId ? (
            <>
              {/* Mobile: back button */}
              <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-slate-100">
                <button onClick={() => select(null)} className="text-xs text-teal-600 flex items-center gap-1">
                  ← Назад
                </button>
              </div>
              <CallLivePanel
                sessionId={state.selectedSessionId}
                initialTab={state.activeTab || undefined}
                onTabChange={(tab) => setState({ activeTab: tab }, { replace: true })}
                className="h-full"
              />
            </>
          ) : (
            <span className="text-slate-400 text-sm">Выберите звонок</span>
          )}
        </main>
      </div>
    </div>
  );
}
