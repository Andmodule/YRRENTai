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
          <h1 className="flex items-center gap-2 text-base font-bold text-foreground">
            <Layers className="h-4 w-4 text-primary dark:text-cyan-400" />
            Rollout Control
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">Управление когортным включением voice AI по объектам</p>
        </div>
        <button
          onClick={() => void refetch()}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground transition-colors hover:text-foreground dark:border-slate-700 dark:bg-slate-800 dark:hover:text-slate-200"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Cohort summary */}
      <section>
        <h2 className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">По когортам</h2>
        <CohortSummaryCards summary={summary} isLoading={isLoading} />
      </section>

      {/* Provider summary */}
      <section>
        <h2 className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">По провайдерам</h2>
        <ProviderSummaryCards summary={summary} isLoading={isLoading} />
      </section>

      {/* Rollout table */}
      <section className="overflow-hidden rounded-xl border border-border bg-card dark:border-slate-700 dark:bg-slate-900/50">
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
      <p className="text-center text-[10px] text-muted-foreground dark:text-slate-600">
        ⚠ Включить voice можно только для объектов в когорте pilot / beta / stable
      </p>
    </div>
  );
}
