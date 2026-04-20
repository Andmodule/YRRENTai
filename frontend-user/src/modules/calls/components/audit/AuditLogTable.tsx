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
  review_assigned:        'text-slate-300',
  review_bulk_assigned:   'text-slate-300',
  review_status_changed:  'text-slate-300',
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
          <div key={i} className="h-10 bg-slate-800/50 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-500">
        <p className="text-sm">Нет записей аудита</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-700/60">
            <th className="pb-2 text-left text-slate-500 uppercase tracking-wide font-medium">Время</th>
            <th className="pb-2 text-left text-slate-500 uppercase tracking-wide font-medium">Действие</th>
            <th className="pb-2 text-left text-slate-500 uppercase tracking-wide font-medium hidden sm:table-cell">Актор</th>
            <th className="pb-2 text-left text-slate-500 uppercase tracking-wide font-medium hidden md:table-cell">Объект</th>
            <th className="pb-2 text-left text-slate-500 uppercase tracking-wide font-medium hidden lg:table-cell">Сущность</th>
            <th className="pb-2 text-left text-slate-500 uppercase tracking-wide font-medium hidden lg:table-cell">Метаданные</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/40">
          {items.map((entry) => (
            <tr
              key={entry.id}
              onClick={() => onSelect(entry)}
              className="cursor-pointer hover:bg-slate-800/30 transition-colors group"
            >
              <td className="py-2.5 pr-4 text-slate-500 whitespace-nowrap font-mono">
                {format(new Date(entry.createdAt), 'dd.MM HH:mm:ss', { locale: ru })}
              </td>
              <td className="py-2.5 pr-4">
                <span className={cn('font-medium', ACTION_COLORS[entry.actionType] ?? 'text-slate-400')}>
                  {ACTION_LABELS[entry.actionType] ?? entry.actionType}
                </span>
              </td>
              <td className="py-2.5 pr-4 hidden sm:table-cell">
                <div className="flex flex-col">
                  <span className="text-slate-300 font-mono">{entry.actorId.slice(0, 8)}…</span>
                  <span className="text-slate-600">{entry.actorRole}</span>
                </div>
              </td>
              <td className="py-2.5 pr-4 hidden md:table-cell text-slate-400 font-mono">
                {entry.propertyId ? entry.propertyId.slice(0, 8) + '…' : '—'}
              </td>
              <td className="py-2.5 pr-4 hidden lg:table-cell text-slate-500">
                {entry.entityType && <span>{entry.entityType}</span>}
                {entry.entityId && <span className="ml-1 font-mono">{entry.entityId.slice(0, 6)}…</span>}
                {!entry.entityType && '—'}
              </td>
              <td className="py-2.5 hidden lg:table-cell text-slate-600 max-w-[200px]">
                <span className="truncate block">{JSON.stringify(entry.metadata).slice(0, 60)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-3 border-t border-slate-800">
          <span className="text-xs text-slate-500">{total} записей, стр. {page + 1}/{totalPages}</span>
          <div className="flex gap-1">
            <button
              onClick={() => onPage(page - 1)}
              disabled={page === 0}
              className="p-1.5 rounded text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => onPage(page + 1)}
              disabled={page >= totalPages - 1}
              className="p-1.5 rounded text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
