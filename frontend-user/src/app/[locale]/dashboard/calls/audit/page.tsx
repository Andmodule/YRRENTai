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
          <h1 className="flex items-center gap-2 text-base font-bold text-foreground">
            <ScrollText className="h-4 w-4 text-primary dark:text-cyan-400" />
            Аудит журнал
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">Критичные управленческие действия</p>
        </div>
        <button
          onClick={() => void refetch()}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground transition-colors hover:text-foreground dark:border-slate-700 dark:bg-slate-800 dark:hover:text-slate-200"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-border bg-card p-3 dark:border-slate-700 dark:bg-slate-800/50">
        <AuditLogFilters
          filters={filters}
          onChange={handleFiltersChange}
          onReset={handleReset}
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card/80 p-4 dark:border-slate-700 dark:bg-slate-900/50">
        {isError ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
            <p className="text-sm">Ошибка загрузки. Попробуйте снова.</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="text-xs text-primary hover:text-primary/80 dark:text-cyan-400 dark:hover:text-cyan-300"
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
