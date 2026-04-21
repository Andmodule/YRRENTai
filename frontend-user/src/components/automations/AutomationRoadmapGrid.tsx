'use client';

import { OperationsCatalogCard } from '@/components/automations/OperationsCatalogCard';
import type { AutomationRoadmapTemplate } from '@/lib/automations/automation-roadmap-template';

export function AutomationRoadmapGrid({ items }: { items: readonly AutomationRoadmapTemplate[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {items.map((template) => (
        <OperationsCatalogCard key={template.ruleKey} template={template} />
      ))}
    </div>
  );
}
