'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CallReviewPanel } from '@/components/calls/CallReviewPanel';
import { CallLivePanel } from '@/components/calls/CallLivePanel';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { fetchQaQueue, bulkUpdateQa, buildExportUrl, type QaQueueItem } from '@/lib/api/calls-stats';
import { QA_QUEUE_KEY } from '@/hooks/use-calls-stats';
import { useUrlState } from '@/hooks/use-url-state';
import { ClipboardCheck, CheckCheck, Eye, Download, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';

// ── Types ─────────────────────────────────────────────────────────────────────

type WorkflowStatus = 'open' | 'in_review' | 'resolved' | 'escalated';

type QaUrlState = {
  reviewStatus: string;
  selectedSessionId: string;
  activeTab: string;
  hasQaFlag: string;
  propertyId: string;
  page: string;
};

const DEFAULTS: QaUrlState = {
  reviewStatus: 'open',
  selectedSessionId: '',
  activeTab: 'review',
  hasQaFlag: '',
  propertyId: '',
  page: '0',
};

const STATUS_TABS: Array<{ key: WorkflowStatus; label: string }> = [
  { key: 'open',      label: 'Открытые' },
  { key: 'in_review', label: 'На проверке' },
  { key: 'resolved',  label: 'Закрытые' },
  { key: 'escalated', label: 'Эскалированные' },
];

// ── Allowed bulk transitions ──────────────────────────────────────────────────
const BULK_ACTIONS: Record<WorkflowStatus, Array<{ status: WorkflowStatus; label: string; variant: 'teal' | 'amber' | 'red' }>> = {
  open:      [{ status: 'in_review', label: 'На проверку', variant: 'teal' }, { status: 'escalated', label: 'Эскалировать', variant: 'red' }],
  in_review: [{ status: 'resolved', label: 'Закрыть', variant: 'teal' }, { status: 'escalated', label: 'Эскалировать', variant: 'red' }, { status: 'open', label: 'Вернуть', variant: 'amber' }],
  resolved:  [{ status: 'open', label: 'Переоткрыть', variant: 'amber' }],
  escalated: [{ status: 'in_review', label: 'На проверку', variant: 'teal' }, { status: 'resolved', label: 'Закрыть', variant: 'teal' }],
};

const QA_FLAG_COLORS: Record<string, string> = {
  emergency_detected:  'bg-red-50 text-red-700',
  unresolved_question: 'bg-amber-50 text-amber-700',
  low_confidence:      'bg-yellow-50 text-yellow-700',
  fallback_triggered:  'bg-orange-50 text-orange-700',
  kb_miss:             'bg-purple-50 text-purple-700',
  transfer_failed:     'bg-red-50 text-red-700',
};

const FLAG_LABELS: Record<string, string> = {
  emergency_detected:  '🚨 Экстренный',
  unresolved_question: '❓ Не решён',
  low_confidence:      '⚠ Низкая ув.',
  fallback_triggered:  '↩ Fallback',
  kb_miss:             '📭 KB miss',
  transfer_failed:     '❌ Трансфер',
  complaint_detected:  '😡 Жалоба',
};

const PAGE_SIZE = 25;

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CallsQaPage() {
  const qc = useQueryClient();
  const [state, setState] = useUrlState<QaUrlState>(DEFAULTS);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  const reviewStatus = (state.reviewStatus as WorkflowStatus) || 'open';
  const page = Number(state.page) || 0;

  const { data, isLoading } = useQuery({
    queryKey: [...QA_QUEUE_KEY, reviewStatus, state.hasQaFlag, state.propertyId, page],
    queryFn: () =>
      fetchQaQueue({
        reviewStatus,
        hasQaFlag: state.hasQaFlag || undefined,
        propertyId: state.propertyId || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const bulkMutation = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: WorkflowStatus }) =>
      bulkUpdateQa(ids, status),
    onSuccess: ({ updated, errors }) => {
      void qc.invalidateQueries({ queryKey: QA_QUEUE_KEY });
      setSelectedItems(new Set());
      if (updated > 0) toast.success(`Обновлено: ${updated}`);
      if (errors.length > 0) toast.error(errors.join('\n'), { description: 'Некоторые переходы недопустимы' });
    },
    onError: () => toast.error('Ошибка обновления'),
  });

  const toggleSelect = useCallback((sessionId: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      next.has(sessionId) ? next.delete(sessionId) : next.add(sessionId);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedItems((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((i) => i.sessionId)),
    );
  }, [items]);

  const selectSession = useCallback((id: string | null) => {
    setState({ selectedSessionId: id ?? '' }, { replace: true });
  }, [setState]);

  const exportUrl = buildExportUrl('qa', {
    reviewStatus: state.reviewStatus || undefined,
    propertyId: state.propertyId || undefined,
  });

  const bulkActions = BULK_ACTIONS[reviewStatus] ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Subheader */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-white shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-teal-600" />
          <span className="text-sm font-semibold text-slate-700">QA Review</span>
          {total > 0 && <span className="text-xs text-slate-400">{total}</span>}
        </div>

        {/* Workflow status tabs */}
        <div className="flex gap-0.5">
          {STATUS_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setState({ reviewStatus: key, page: '0', selectedSessionId: '' }, { replace: true })}
              className={cn(
                'px-2.5 py-1 rounded-lg text-xs font-medium transition-colors',
                reviewStatus === key ? 'bg-teal-50 text-teal-700' : 'text-slate-500 hover:bg-slate-100',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <a
          href={exportUrl}
          download
          className="flex items-center gap-1 h-7 px-2 rounded-lg text-xs text-slate-500 hover:bg-slate-100"
        >
          <Download className="h-3 w-3" />CSV
        </a>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 px-4 py-1.5 bg-slate-50 border-b border-slate-100 shrink-0">
        <select
          value={state.hasQaFlag}
          onChange={(e) => setState({ hasQaFlag: e.target.value, page: '0' }, { replace: true })}
          className="h-7 rounded-lg border border-slate-200 px-2 text-xs focus:outline-none"
        >
          <option value="">Все флаги</option>
          {Object.entries(FLAG_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        {state.hasQaFlag && (
          <button
            onClick={() => setState({ hasQaFlag: '' }, { replace: true })}
            className="h-7 px-1.5 rounded-lg text-xs text-slate-400 hover:bg-slate-200 flex items-center"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Bulk actions bar */}
      {selectedItems.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-teal-50 border-b border-teal-100 shrink-0 flex-wrap">
          <span className="text-xs text-teal-700 font-medium shrink-0">
            Выбрано: {selectedItems.size}
          </span>
          {bulkActions.map(({ status, label, variant }) => (
            <Button
              key={status}
              size="sm"
              variant="outline"
              disabled={bulkMutation.isPending}
              className={cn(
                'h-7 text-xs gap-1',
                variant === 'teal' && 'border-teal-200 text-teal-700',
                variant === 'amber' && 'border-amber-200 text-amber-700',
                variant === 'red' && 'border-red-200 text-red-700',
              )}
              onClick={() => bulkMutation.mutate({ ids: [...selectedItems], status })}
            >
              {status === 'resolved' && <CheckCheck className="h-3 w-3" />}
              {label}
            </Button>
          ))}
          <button
            className="ml-auto text-xs text-slate-400 hover:text-slate-600 shrink-0"
            onClick={() => setSelectedItems(new Set())}
          >
            Отмена
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Queue list */}
        <aside className={cn(
          'bg-white border-r border-slate-200 flex flex-col',
          state.selectedSessionId ? 'hidden md:flex md:w-80' : 'flex w-full md:w-80',
        )}>
          {isLoading ? (
            <div className="flex flex-col gap-2 p-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 text-slate-300">
              <ClipboardCheck className="h-8 w-8 opacity-40" />
              <span className="text-sm">Очередь пуста</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 shrink-0">
                <input
                  type="checkbox"
                  className="accent-teal-600"
                  checked={selectedItems.size === items.length && items.length > 0}
                  onChange={toggleAll}
                />
                <span className="text-xs text-slate-400">Выбрать все</span>
              </div>

              <ul className="flex-1 overflow-y-auto">
                {items.map((item) => (
                  <QaQueueRow
                    key={item.sessionId}
                    item={item}
                    isSelected={item.sessionId === state.selectedSessionId}
                    isChecked={selectedItems.has(item.sessionId)}
                    onSelect={selectSession}
                    onCheck={toggleSelect}
                  />
                ))}
              </ul>

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

        {/* Review workspace */}
        <main className={cn(
          'flex-1 min-w-0 bg-white flex flex-col',
          !state.selectedSessionId && 'hidden md:flex md:items-center md:justify-center',
        )}>
          {state.selectedSessionId ? (
            <>
              {/* Mobile back */}
              <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-slate-100 shrink-0">
                <button onClick={() => selectSession(null)} className="text-xs text-teal-600">← Назад</button>
              </div>

              {/* View mode toggle */}
              <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-100 shrink-0">
                {(['review', 'transcript', 'events'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setState({ activeTab: tab }, { replace: true })}
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                      state.activeTab === tab ? 'bg-teal-50 text-teal-700' : 'text-slate-500 hover:bg-slate-100',
                    )}
                  >
                    {tab === 'review' && <ClipboardCheck className="h-3.5 w-3.5" />}
                    {tab === 'transcript' && <Eye className="h-3.5 w-3.5" />}
                    {tab === 'events' && <Eye className="h-3.5 w-3.5" />}
                    {tab === 'review' ? 'Ревью' : tab === 'transcript' ? 'Транскрипт' : 'События'}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto">
                {state.activeTab === 'review' ? (
                  <div className="p-4">
                    <CallReviewPanel sessionId={state.selectedSessionId} />
                  </div>
                ) : (
                  <CallLivePanel
                    sessionId={state.selectedSessionId}
                    initialTab={state.activeTab === 'events' ? 'events' : 'transcript'}
                    className="h-full"
                  />
                )}
              </div>
            </>
          ) : (
            <span className="text-slate-400 text-sm">Выберите звонок из очереди</span>
          )}
        </main>
      </div>
    </div>
  );
}

// ── Queue row ─────────────────────────────────────────────────────────────────

function QaQueueRow({
  item, isSelected, isChecked, onSelect, onCheck,
}: {
  item: QaQueueItem;
  isSelected: boolean;
  isChecked: boolean;
  onSelect: (id: string) => void;
  onCheck: (id: string) => void;
}) {
  return (
    <li
      className={cn(
        'flex items-start gap-2.5 px-3 py-3 border-b border-slate-50 cursor-pointer transition-colors',
        isSelected ? 'bg-teal-50' : 'hover:bg-slate-50',
      )}
      onClick={() => onSelect(item.sessionId)}
    >
      <input
        type="checkbox"
        className="mt-0.5 accent-teal-600 shrink-0"
        checked={isChecked}
        onChange={(e) => { e.stopPropagation(); onCheck(item.sessionId); }}
        onClick={(e) => e.stopPropagation()}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="text-sm font-medium text-slate-700 truncate">
            {item.guestPhone ?? 'Неизвестный'}
          </span>
          <span className="text-[11px] text-slate-400 shrink-0">
            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: ru })}
          </span>
        </div>
        {item.qaFlags && item.qaFlags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {item.qaFlags.slice(0, 3).map((f) => (
              <span key={f} className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', QA_FLAG_COLORS[f] ?? 'bg-slate-100 text-slate-600')}>
                {FLAG_LABELS[f] ?? f}
              </span>
            ))}
            {item.qaFlags.length > 3 && (
              <span className="text-[10px] text-slate-400">+{item.qaFlags.length - 3}</span>
            )}
          </div>
        )}
        <div className="flex gap-3 mt-1 text-[11px] text-slate-400">
          {item.totalTurns !== null && <span>{item.totalTurns} реплик</span>}
          {item.durationSeconds !== null && <span>{item.durationSeconds}с</span>}
          {item.followUpRequired && <span className="text-teal-600">🔔 Follow-up</span>}
        </div>
      </div>
    </li>
  );
}
