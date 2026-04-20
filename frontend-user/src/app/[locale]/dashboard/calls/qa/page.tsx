'use client';

import { useState, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useQaQueue, useBulkQaUpdate } from '@/hooks/use-calls-admin';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ClipboardCheck, CheckCheck, Download, UserCheck, Users } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { QaQueueItem } from '@/lib/api/calls-admin';
import { buildExportUrl } from '@/lib/api/calls-admin';
import { QaAssignDialog } from '@/modules/calls/components/qa/QaAssignDialog';
import { QaWorkloadWidget } from '@/modules/calls/components/qa/QaWorkloadWidget';

type WorkflowStatus = 'open' | 'in_review' | 'resolved' | 'escalated';

const STATUS_TABS: Array<{ key: WorkflowStatus; label: string }> = [
  { key: 'open',      label: 'Открытые' },
  { key: 'in_review', label: 'На проверке' },
  { key: 'resolved',  label: 'Закрытые' },
  { key: 'escalated', label: 'Эскалир.' },
];

const BULK_ACTIONS: Record<WorkflowStatus, Array<{ status: WorkflowStatus; label: string; color: string }>> = {
  open:      [{ status: 'in_review', label: 'На проверку', color: 'text-cyan-300 border-cyan-500/30' }, { status: 'escalated', label: 'Эскалировать', color: 'text-red-300 border-red-500/30' }],
  in_review: [{ status: 'resolved',  label: 'Закрыть',     color: 'text-teal-300 border-teal-500/30' }, { status: 'escalated', label: 'Эскалировать', color: 'text-red-300 border-red-500/30' }],
  resolved:  [{ status: 'open',      label: 'Переоткрыть', color: 'text-amber-300 border-amber-500/30' }],
  escalated: [{ status: 'in_review', label: 'На проверку', color: 'text-cyan-300 border-cyan-500/30' }, { status: 'resolved', label: 'Закрыть', color: 'text-teal-300 border-teal-500/30' }],
};

const FLAG_LABELS: Record<string, string> = {
  emergency_detected: '🚨', unresolved_question: '❓', low_confidence: '⚠',
  fallback_triggered: '↩', kb_miss: '📭', transfer_failed: '❌',
};

const PAGE_SIZE = 25;

function useUrlState() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = (k: string, d = '') => sp.get(k) ?? d;
  const set = (u: Record<string, string | undefined>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(u)) { if (!v) p.delete(k); else p.set(k, v); }
    router.replace(`${pathname}?${p}`);
  };
  return { get, set };
}

function QaRow({ item, isSelected, isChecked, onSelect, onCheck }: {
  item: QaQueueItem; isSelected: boolean; isChecked: boolean;
  onSelect: (id: string) => void; onCheck: (id: string) => void;
}) {
  return (
    <div
      className={cn('flex cursor-pointer items-start gap-2.5 border-b border-border px-3 py-3 transition-colors dark:border-slate-700/30', isSelected ? 'bg-primary/10 dark:bg-cyan-500/10' : 'hover:bg-muted/80 dark:hover:bg-slate-800/60')}
      onClick={() => onSelect(item.sessionId)}
    >
      <input type="checkbox" className="mt-0.5 accent-cyan-400 shrink-0"
        checked={isChecked} onChange={() => onCheck(item.sessionId)}
        onClick={(e) => e.stopPropagation()} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-sm font-medium text-foreground dark:text-slate-200">{item.guestPhone ?? '—'}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: ru })}
          </span>
        </div>
        {item.qaFlags && item.qaFlags.length > 0 && (
          <div className="flex gap-0.5 mt-0.5">
            {item.qaFlags.slice(0, 4).map((f) => (
              <span key={f} title={f} className="text-xs">{FLAG_LABELS[f] ?? '·'}</span>
            ))}
          </div>
        )}
        <div className="text-xs text-muted-foreground">
          {item.totalTurns !== null && `${item.totalTurns} реплик`}
          {item.followUpRequired && ' · 🔔 follow-up'}
        </div>
      </div>
    </div>
  );
}

function ReviewDetail({ item, onBack }: { item: QaQueueItem; onBack: () => void }) {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="shrink-0 border-b border-border px-4 py-2 dark:border-slate-700/50 md:hidden">
        <button type="button" onClick={onBack} className="text-xs text-primary dark:text-cyan-400">
          ← Назад
        </button>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-foreground dark:text-slate-200">{item.guestPhone ?? '—'}</h3>
          <p className="text-xs text-muted-foreground">#{item.sessionId.slice(0, 8)} · {item.status}</p>
        </div>
        {item.escalationReason && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <div className="text-xs font-semibold text-amber-300 mb-1">Причина эскалации</div>
            <p className="text-sm text-amber-200">{item.escalationReason}</p>
          </div>
        )}
        {item.qaFlags && item.qaFlags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {item.qaFlags.map((f) => (
              <span key={f} className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {FLAG_LABELS[f] ?? ''} {f.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {[
            ['Реплики', item.totalTurns],
            ['Длительность', item.durationSeconds ? `${item.durationSeconds}с` : '—'],
            ['Follow-up', item.followUpRequired ? '🔔 Да' : 'Нет'],
            ['Статус', item.status],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-lg border border-border bg-muted/50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
              <div className="text-[10px] uppercase text-muted-foreground">{k}</div>
              <div className="text-sm font-semibold text-foreground dark:text-slate-200">{String(v ?? '—')}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CallsQaPage() {
  const { get, set } = useUrlState();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const reviewStatus = (get('reviewStatus', 'open')) as WorkflowStatus;
  const page = Number(get('page', '0'));
  const selectedId = get('selectedSessionId');

  const { data, isLoading } = useQaQueue({ reviewStatus, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const bulkMutation = useBulkQaUpdate();

  const toggleCheck = useCallback((id: string) => {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const handleBulk = async (status: WorkflowStatus) => {
    const { updated, errors } = await bulkMutation.mutateAsync({ ids: [...selected], status });
    setSelected(new Set());
    if (updated > 0) toast.success(`Обновлено: ${updated}`);
    if (errors.length > 0) toast.error(errors.join('\n'));
  };

  const selectedItem = items.find((i) => i.sessionId === selectedId) ?? null;
  const bulkActions = BULK_ACTIONS[reviewStatus] ?? [];
  const exportUrl = buildExportUrl('qa', { reviewStatus });

  return (
    <div className="flex h-[calc(100vh-10rem)] overflow-hidden rounded-xl border border-border bg-card dark:border-slate-700 dark:bg-slate-900">
      {/* Left panel */}
      <aside className={cn('flex flex-col border-r border-border dark:border-slate-700', selectedId ? 'hidden md:flex md:w-80' : 'flex w-full md:w-80')}>
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 dark:border-slate-700/50">
          <ClipboardCheck className="h-4 w-4 text-primary dark:text-cyan-400" />
          <span className="text-xs font-semibold text-foreground dark:text-slate-300">QA Review</span>
          {total > 0 && <span className="text-xs text-muted-foreground">{total}</span>}
          <div className="ml-auto flex items-center gap-1">
            {selected.size > 0 && (
              <QaAssignDialog
                reviewIds={[...selected].map((sid) => items.find((i) => i.sessionId === sid)?.reviewId ?? sid).filter(Boolean)}
                onSuccess={() => setSelected(new Set())}
              >
                <button className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-primary dark:hover:bg-slate-700/50 dark:hover:text-cyan-300">
                  <UserCheck className="h-3 w-3" />
                  Назначить
                </button>
              </QaAssignDialog>
            )}
            <a href={exportUrl} download className="text-muted-foreground hover:text-primary dark:hover:text-cyan-400">
              <Download className="h-3 w-3" />
            </a>
          </div>
        </div>

        {/* Status tabs */}
        <div className="flex shrink-0 border-b border-border dark:border-slate-700/50">
          {STATUS_TABS.map(({ key, label }) => (
            <button key={key} onClick={() => set({ reviewStatus: key, page: '0', selectedSessionId: '' })}
              className={cn('flex-1 py-2 text-[10px] font-medium transition-colors', reviewStatus === key ? 'border-b-2 border-primary text-primary dark:border-cyan-400 dark:text-cyan-300' : 'text-muted-foreground hover:text-foreground dark:hover:text-slate-300')}>
              {label}
            </button>
          ))}
        </div>

        {/* Bulk actions bar */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-cyan-500/5 border-b border-cyan-500/20 shrink-0">
            <span className="text-xs text-cyan-300 font-medium">{selected.size}</span>
            {bulkActions.map(({ status, label, color }) => (
              <button key={status} disabled={bulkMutation.isPending}
                onClick={() => void handleBulk(status)}
                className={cn('flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium disabled:opacity-50 hover:bg-white/5', color)}>
                {status === 'resolved' && <CheckCheck className="h-3 w-3" />}
                {label}
              </button>
            ))}
            <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-xs text-muted-foreground hover:text-foreground dark:hover:text-slate-300">
              ✕
            </button>
          </div>
        )}

        {/* Select all */}
        {items.length > 0 && (
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 dark:border-slate-700/30">
            <input type="checkbox" className="accent-primary dark:accent-cyan-400"
              checked={selected.size === items.length} onChange={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((i) => i.sessionId)))} />
            <span className="text-xs text-muted-foreground">Выбрать все</span>
          </div>
        )}

        {/* Queue */}
        {isLoading ? (
          <div className="space-y-1 p-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-xl bg-muted dark:bg-slate-800" />)}</div>
        ) : items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
            <ClipboardCheck className="h-8 w-8 opacity-20" />
            <span className="text-sm">Очередь пуста</span>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {items.map((item) => (
              <QaRow key={item.sessionId} item={item}
                isSelected={item.sessionId === selectedId}
                isChecked={selected.has(item.sessionId)}
                onSelect={(id) => set({ selectedSessionId: id })}
                onCheck={toggleCheck} />
            ))}
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground dark:border-slate-700/50">
            <button disabled={page === 0} onClick={() => set({ page: String(page - 1) })} className="disabled:opacity-40">← Назад</button>
            <span>{page + 1} / {Math.ceil(total / PAGE_SIZE)}</span>
            <button disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => set({ page: String(page + 1) })} className="disabled:opacity-40">Далее →</button>
          </div>
        )}
      </aside>

      {/* Detail + Workload */}
      <main className={cn('flex-1 min-w-0 flex flex-col', !selectedId && 'hidden md:flex')}>
        {selectedItem ? (
          <>
            <ReviewDetail item={selectedItem} onBack={() => set({ selectedSessionId: '' })} />
            {/* Assign button in detail */}
            <div className="shrink-0 border-t border-border p-3 dark:border-slate-700/50">
              <QaAssignDialog reviewId={selectedItem.reviewId}>
                <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-muted/70 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-cyan-500/40 dark:hover:text-cyan-300">
                  <UserCheck className="h-3.5 w-3.5" />
                  Назначить ревьюера
                </button>
              </QaAssignDialog>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-4">
            <ClipboardCheck className="h-10 w-10 text-muted-foreground/40 dark:text-slate-700" />
            <span className="text-sm text-muted-foreground">Выберите звонок из очереди</span>
            {/* Workload widget visible when nothing selected */}
            <div className="w-full max-w-xs mt-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Workload</span>
              </div>
              <QaWorkloadWidget />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
