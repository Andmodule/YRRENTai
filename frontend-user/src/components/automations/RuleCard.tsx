'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { AutomationRule } from '@/types/automations';

export type RuleCardProps = {
  rule: AutomationRule;
  onEdit: (rule: AutomationRule) => void;
  onToggleStatus: (rule: AutomationRule, nextActive: boolean) => void;
  toggleDisabled?: boolean;
};

export function RuleCard({ rule, onEdit, onToggleStatus, toggleDisabled }: RuleCardProps) {
  const t = useTranslations('automations');
  const title =
    rule.titleKey === 'rules.generic.title'
      ? t('rules.generic.title', { key: rule.key })
      : t(rule.titleKey);
  const description =
    rule.descriptionKey === 'rules.generic.description'
      ? t('rules.generic.description', { key: rule.key })
      : t(rule.descriptionKey);

  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow',
        'hover:shadow-md dark:border-slate-800 dark:bg-slate-900',
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold leading-snug text-foreground">{title}</h3>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{rule.key}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {rule.status === 'active' ? t('rules.active') : t('rules.inactive')}
            </span>
            <Switch
              checked={rule.status === 'active'}
              disabled={toggleDisabled}
              onCheckedChange={(checked) => onToggleStatus(rule, checked)}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              aria-label={title}
            />
          </div>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="flex justify-end border-t border-border/60 pt-3 dark:border-slate-800">
        <Button type="button" variant="outline" size="sm" onClick={() => onEdit(rule)}>
          {t('rules.configure')}
        </Button>
      </div>
    </div>
  );
}
