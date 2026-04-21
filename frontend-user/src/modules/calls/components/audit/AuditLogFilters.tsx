'use client';

import { cn } from '@/lib/utils';
import { Search, X } from 'lucide-react';

export const ACTION_TYPE_OPTIONS = [
  { value: '', label: 'Все действия' },
  { value: 'export_qa_queue',         label: 'Экспорт QA' },
  { value: 'export_session_history',  label: 'Экспорт истории' },
  { value: 'review_status_changed',   label: 'Статус ревью' },
  { value: 'review_assigned',         label: 'Назначение ревью' },
  { value: 'review_bulk_assigned',    label: 'Массовое назначение' },
  { value: 'alert_acknowledged',      label: 'Алерт подтверждён' },
  { value: 'alert_resolved',          label: 'Алерт разрешён' },
  { value: 'rollout_changed',         label: 'Rollout изменён' },
  { value: 'cohort_changed',          label: 'Cohort изменён' },
  { value: 'bulk_cohort_changed',     label: 'Bulk cohort' },
  { value: 'provider_changed',        label: 'Provider изменён' },
];

export interface AuditFilters {
  actionType?: string;
  actorId?: string;
  propertyId?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface Props {
  filters: AuditFilters;
  onChange: (f: Partial<AuditFilters>) => void;
  onReset: () => void;
}

export function AuditLogFilters({ filters, onChange, onReset }: Props) {
  const hasActive = Object.values(filters).some(Boolean);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex-1 min-w-[160px]">
        <label className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Тип действия</label>
        <select
          value={filters.actionType ?? ''}
          onChange={(e) => onChange({ actionType: e.target.value || undefined })}
          className="w-full rounded-lg border border-input bg-input-fill px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:ring-cyan-500"
        >
          {ACTION_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 min-w-[140px]">
        <label className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Объект (ID)</label>
        <input
          value={filters.propertyId ?? ''}
          onChange={(e) => onChange({ propertyId: e.target.value || undefined })}
          placeholder="UUID объекта"
          className="w-full rounded-lg border border-input bg-input-fill px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-600 dark:focus:ring-cyan-500"
        />
      </div>

      <div className="flex-1 min-w-[130px]">
        <label className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">С даты</label>
        <input
          type="date"
          value={filters.dateFrom ?? ''}
          onChange={(e) => onChange({ dateFrom: e.target.value || undefined })}
          className="w-full rounded-lg border border-input bg-input-fill px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:ring-cyan-500"
        />
      </div>

      <div className="flex-1 min-w-[130px]">
        <label className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">По дату</label>
        <input
          type="date"
          value={filters.dateTo ?? ''}
          onChange={(e) => onChange({ dateTo: e.target.value || undefined })}
          className="w-full rounded-lg border border-input bg-input-fill px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:ring-cyan-500"
        />
      </div>

      {hasActive && (
        <button
          onClick={onReset}
          className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground dark:border-slate-700 dark:hover:border-slate-600 dark:hover:text-white"
        >
          <X className="h-3 w-3" /> Сброс
        </button>
      )}
    </div>
  );
}
