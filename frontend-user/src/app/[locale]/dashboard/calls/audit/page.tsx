'use client';

import { useState, useCallback } from 'react';
import { useAuditLog } from '@/hooks/use-calls-admin';
import { AuditLogFilters } from '@/modules/calls/components/audit/AuditLogFilters';
import { AuditLogTable } from '@/modules/calls/components/audit/AuditLogTable';
import { AuditLogDrawer } from '@/modules/calls/components/audit/AuditLogDrawer';
import { ScrollText, RefreshCw } from 'lucide-react';
import type { AuditFilters } from '@/modules/calls/components/audit/AuditLogFilters';
import type { AuditLogEntry } from '@/lib/api/calls-admin';

const PAGE_SIZE = 50;

export default function CallsAuditPage() {
  const [filters, setFilters] = useState<AuditFilters>({});
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  const { data, isLoading, refetch, isError } = useAuditLog({
    ...filters,
    page,
    pageSize: PAGE_SIZE,
  });

  const handleFiltersChange = useCallback((updates: Partial<AuditFilters>) => {
    setFilters((prev) => ({ ...prev, ...updates }));
    setPage(0);
  }, []);

  const handleReset = useCallback(() => {
    setFilters({});
    setPage(0);
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-white flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-cyan-400" />
            Аудит журнал
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">Критичные управленческие действия</p>
        </div>
        <button
          onClick={() => void refetch()}
          className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-3">
        <AuditLogFilters
          filters={filters}
          onChange={handleFiltersChange}
          onReset={handleReset}
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
        {isError ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-500 gap-2">
            <p className="text-sm">Ошибка загрузки. Попробуйте снова.</p>
            <button
              onClick={() => void refetch()}
              className="text-xs text-cyan-400 hover:text-cyan-300"
            >
              Повторить
            </button>
          </div>
        ) : (
          <AuditLogTable
            items={data?.items ?? []}
            total={data?.total ?? 0}
            page={page}
            pageSize={PAGE_SIZE}
            onPage={setPage}
            onSelect={setSelected}
            isLoading={isLoading}
          />
        )}
      </div>

      {/* Detail drawer */}
      <AuditLogDrawer entry={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
