'use client';

import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { Incident } from '@/modules/incidents/hooks/useIncidents';
import { IncidentKanbanCard } from '@/modules/incidents/components/IncidentKanbanCard';

export const KanbanIncidentsStrip = memo(function KanbanIncidentsStrip({
  incidents,
  onOpenIncident,
}: {
  incidents: Incident[];
  onOpenIncident: (i: Incident) => void;
}) {
  const t = useTranslations('tasks.listByProperty');

  if (incidents.length === 0) return null;

  return (
    <section
      aria-label={t('incidentsTopHeading')}
      className={cn(
        'shrink-0 rounded-xl border border-red-500/25 bg-red-500/[0.04] p-3 shadow-sm',
        'dark:border-red-900/50 dark:bg-red-950/20',
      )}
    >
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-800/90 dark:text-red-300/90">
        {t('incidentsTopHeading')}
      </h2>
      <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {incidents.map((i) => (
          <div key={i.uuid} className="w-[min(100%,260px)] shrink-0">
            <IncidentKanbanCard incident={i} onOpen={onOpenIncident} />
          </div>
        ))}
      </div>
    </section>
  );
});
