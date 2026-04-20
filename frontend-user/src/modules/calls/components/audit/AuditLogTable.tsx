'use client';

import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { AuditLogEntry } from '@/lib/api/calls-admin';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const ACTION_COLORS: Record<string, string> = {
  export_qa_queue:        'text-amber-400',
  export_session_history: 'text-amber-400',
  alert_acknowledged:     'text-cyan-400',
  alert_resolved:         'text-teal-400',
  rollout_changed:        'text-blue-400',
  cohort_changed:         'text-blue-400',
  bulk_cohort_changed:    'text-blue-400',
  provider_changed:       'text-blue-400',
  review_assigned: 'text-foreground/90 dark:text-slate-300',
  review_bulk_assigned: 'text-foreground/90 dark:text-slate-300',
  review_status_changed: 'text-foreground/90 dark:text-slate-300',
};

const ACTION_LABELS: Record<string, string> = {
  export_qa_queue:        'Export QA',
  export_session_history: 'Export history',
  alert_acknowledged:     'Alert ack',
  alert_resolved:         'Alert resolve',
  rollout_changed:        'Rollout change',
  cohort_changed:         'Cohort change',
  bulk_cohort_changed:    'Bulk cohort',
  provider_changed:       'Provider change',
  review_assigned:        'Review assign',
  review_bulk_assigned:   'Bulk assign',
  review_status_changed:  'Review status',
};

interface Props {
  items: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onSelect: (entry: AuditLogEntry) => void;
  isLoading?: boolean;
}

export function AuditLogTable({ items, total, page, pageSize, onPage, onSelect, isLoading }: Props) {
  const totalPages = Math.ceil(total / pageSize);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-muted dark:bg-slate-800/50" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-sm">Нет записей аудита</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border dark:border-slate-700/60">
            <th className="pb-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Время</th>
            <th className="pb-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Действие</th>
            <th className="hidden pb-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground sm:table-cell">Актор</th>
            <th className="hidden pb-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground md:table-cell">Объект</th>
            <th className="hidden pb-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground lg:table-cell">Сущность</th>
            <th className="hidden pb-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground lg:table-cell">Метаданные</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border dark:divide-slate-800/40">
          {items.map((entry) => (
            <tr
              key={entry.id}
              onClick={() => onSelect(entry)}
              className="group cursor-pointer transition-colors hover:bg-muted/80 dark:hover:bg-slate-800/30"
            >
              <td className="whitespace-nowrap py-2.5 pr-4 font-mono text-muted-foreground">
                {format(new Date(entry.createdAt), 'dd.MM HH:mm:ss', { locale: ru })}
              </td>
              <td className="py-2.5 pr-4">
                <span className={cn('font-medium', ACTION_COLORS[entry.actionType] ?? 'text-muted-foreground dark:text-slate-400')}>
                  {ACTION_LABELS[entry.actionType] ?? entry.actionType}
                </span>
              </td>
              <td className="py-2.5 pr-4 hidden sm:table-cell">
                <div className="flex flex-col">
                  <span className="font-mono text-foreground dark:text-slate-300">{entry.actorId.slice(0, 8)}…</span>
                  <span className="text-muted-foreground dark:text-slate-600">{entry.actorRole}</span>
                </div>
              </td>
              <td className="hidden py-2.5 pr-4 font-mono text-muted-foreground md:table-cell dark:text-slate-400">
                {entry.propertyId ? entry.propertyId.slice(0, 8) + '…' : '—'}
              </td>
              <td className="hidden py-2.5 pr-4 text-muted-foreground lg:table-cell dark:text-slate-500">
                {entry.entityType && <span>{entry.entityType}</span>}
                {entry.entityId && <span className="ml-1 font-mono">{entry.entityId.slice(0, 6)}…</span>}
                {!entry.entityType && '—'}
              </td>
              <td className="hidden max-w-[200px] py-2.5 text-muted-foreground lg:table-cell dark:text-slate-600">
                <span className="block truncate">{JSON.stringify(entry.metadata).slice(0, 60)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border pt-3 dark:border-slate-800">
          <span className="text-xs text-muted-foreground">{total} записей, стр. {page + 1}/{totalPages}</span>
          <div className="flex gap-1">
            <button
              onClick={() => onPage(page - 1)}
              disabled={page === 0}
              className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30 dark:hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => onPage(page + 1)}
              disabled={page >= totalPages - 1}
              className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30 dark:hover:text-white"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
