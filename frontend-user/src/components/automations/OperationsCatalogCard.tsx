'use client';

import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AutomationRoadmapTemplate } from '@/lib/automations/automation-roadmap-template';

export type OperationsCatalogCardProps = {
  template: AutomationRoadmapTemplate;
  /** Creating this template's rule (only for creatable) */
  isCreating?: boolean;
  onEnable?: () => void;
};

export function OperationsCatalogCard({ template, isCreating, onEnable }: OperationsCatalogCardProps) {
  const t = useTranslations('automations');
  const title = t(template.titleKey);
  const description = t(template.descriptionKey);

  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/90 p-4 dark:border-slate-600 dark:bg-slate-900/50',
      )}
    >
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-base font-semibold leading-snug text-foreground">{title}</h3>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{template.ruleKey}</p>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium',
              template.creatable
                ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-100'
                : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
            )}
          >
            {template.creatable ? t('operations.badgeNotConfigured') : t('operations.badgeComingSoon')}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="flex justify-end border-t border-border/60 pt-3 dark:border-slate-800">
        {template.creatable && onEnable ? (
          <Button type="button" size="sm" disabled={isCreating} onClick={() => onEnable()}>
            {isCreating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                {t('operations.creating')}
              </>
            ) : (
              t('operations.enableForProperty')
            )}
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="sm" className="pointer-events-none text-muted-foreground" disabled>
            {t('operations.roadmapNote')}
          </Button>
        )}
      </div>
    </div>
  );
}
