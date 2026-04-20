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
        <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wide">Тип действия</label>
        <select
          value={filters.actionType ?? ''}
          onChange={(e) => onChange({ actionType: e.target.value || undefined })}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
        >
          {ACTION_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 min-w-[140px]">
        <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wide">Объект (ID)</label>
        <input
          value={filters.propertyId ?? ''}
          onChange={(e) => onChange({ propertyId: e.target.value || undefined })}
          placeholder="UUID объекта"
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500"
        />
      </div>

      <div className="flex-1 min-w-[130px]">
        <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wide">С даты</label>
        <input
          type="date"
          value={filters.dateFrom ?? ''}
          onChange={(e) => onChange({ dateFrom: e.target.value || undefined })}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
        />
      </div>

      <div className="flex-1 min-w-[130px]">
        <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wide">По дату</label>
        <input
          type="date"
          value={filters.dateTo ?? ''}
          onChange={(e) => onChange({ dateTo: e.target.value || undefined })}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
        />
      </div>

      {hasActive && (
        <button
          onClick={onReset}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 transition-colors"
        >
          <X className="h-3 w-3" /> Сброс
        </button>
      )}
    </div>
  );
}
