'use client';

import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { Incident } from '../hooks/useIncidents';

const TYPE_CLASS: Record<Incident['type'], string> = {
  damage: 'border-red-500/20 bg-red-500/5 text-red-800/85 dark:text-red-200/60',
  lost_item: 'border-yellow-500/20 bg-yellow-500/6 text-yellow-900/75 dark:text-yellow-200/55',
  rule_violation: 'border-orange-500/25 bg-orange-500/8 text-orange-950/90 dark:text-orange-100/80',
  emergency: 'border-violet-500/35 bg-violet-500/12 text-violet-950 dark:text-violet-100',
  task_report: 'border-sky-500/25 bg-sky-500/8 text-sky-950/90 dark:text-sky-100/85',
};

/** Keys under `tasks.kanban.incidentCard` — shared for list/kanban fallbacks. */
export const INCIDENT_TYPE_LABEL_KEY: Record<
  Incident['type'],
  'typeDamage' | 'typeLost' | 'typeRuleViolation' | 'typeEmergency' | 'typeTaskReport'
> = {
  damage: 'typeDamage',
  lost_item: 'typeLost',
  rule_violation: 'typeRuleViolation',
  emergency: 'typeEmergency',
  task_report: 'typeTaskReport',
};

export const IncidentTypePill = memo(function IncidentTypePill({
  type,
  className,
}: {
  type: Incident['type'];
  className?: string;
}) {
  const t = useTranslations('tasks.kanban.incidentCard');
  const label = t(INCIDENT_TYPE_LABEL_KEY[type]);

  return (
    <span
      className={cn(
        'inline-flex max-w-full shrink-0 items-center rounded-full border px-1.5 py-px text-[9px] font-normal leading-tight',
        TYPE_CLASS[type],
        className,
      )}
    >
      {label}
    </span>
  );
});
