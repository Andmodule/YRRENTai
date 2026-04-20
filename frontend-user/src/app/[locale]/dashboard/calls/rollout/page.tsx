'use client';

import { useState, useCallback } from 'react';
import { useRolloutDashboard } from '@/hooks/use-calls-admin';
import { CohortSummaryCards } from '@/modules/calls/components/rollout/CohortSummaryCards';
import { ProviderSummaryCards } from '@/modules/calls/components/rollout/ProviderSummaryCards';
import { RolloutTable } from '@/modules/calls/components/rollout/RolloutTable';
import { BulkCohortActionBar } from '@/modules/calls/components/rollout/BulkCohortActionBar';
import { RefreshCw, Layers } from 'lucide-react';

export default function CallsRolloutPage() {
  const { data, isLoading, refetch } = useRolloutDashboard();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const handleClear = useCallback(() => setSelectedIds(new Set()), []);

  const properties = data?.properties ?? [];
  const summary = data?.summary ?? { byCohort: { disabled: 0, pilot: 0, beta: 0, stable: 0 }, byProvider: {}, totalEnabled: 0, totalDisabled: 0 };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-white flex items-center gap-2">
            <Layers className="h-4 w-4 text-cyan-400" />
            Rollout Control
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">Управление когортным включением voice AI по объектам</p>
        </div>
        <button
          onClick={() => void refetch()}
          className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Cohort summary */}
      <section>
        <h2 className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">По когортам</h2>
        <CohortSummaryCards summary={summary} isLoading={isLoading} />
      </section>

      {/* Provider summary */}
      <section>
        <h2 className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">По провайдерам</h2>
        <ProviderSummaryCards summary={summary} isLoading={isLoading} />
      </section>

      {/* Rollout table */}
      <section className="rounded-xl border border-slate-700 bg-slate-900/50 overflow-hidden">
        {/* Bulk actions bar */}
        <BulkCohortActionBar selectedIds={[...selectedIds]} onClear={handleClear} />

        <div className="p-4">
          <RolloutTable
            properties={properties}
            selectedIds={selectedIds}
            onToggleSelect={handleToggle}
            onSelectAll={handleSelectAll}
            isLoading={isLoading}
          />
        </div>
      </section>

      {/* Warning: cannot enable without pilot+ cohort */}
      <p className="text-[10px] text-slate-600 text-center">
        ⚠ Включить voice можно только для объектов в когорте pilot / beta / stable
      </p>
    </div>
  );
}
