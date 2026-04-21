'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isAxiosError } from 'axios';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { OperationsCatalogCard } from '@/components/automations/OperationsCatalogCard';
import { RuleCard } from '@/components/automations/RuleCard';
import { RuleSettingsSheet } from '@/components/automations/RuleSettingsSheet';
import { useAutomationRules } from '@/hooks/use-automation-rules';
import { useProperties } from '@/hooks/use-properties';
import { OPERATIONS_RULE_TEMPLATES } from '@/lib/automations/operations-catalog';
import { cn } from '@/lib/utils';
import type { AutomationRule } from '@/types/automations';
import { toast } from 'sonner';

function RuleCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-xl border border-slate-200 bg-slate-100/80 p-4 dark:border-slate-800 dark:bg-slate-800/40',
        className,
      )}
    >
      <div className="h-5 w-2/3 max-w-xs rounded bg-slate-200 dark:bg-slate-700" />
      <div className="mt-3 h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" />
      <div className="mt-4 h-10 w-full rounded-md bg-slate-200/90 dark:bg-slate-700/80" />
      <div className="mt-4 flex justify-end border-t border-slate-200/80 pt-3 dark:border-slate-700">
        <div className="h-9 w-28 rounded-md bg-slate-200 dark:bg-slate-700" />
      </div>
    </div>
  );
}

export default function AutomationsOperationsPage() {
  const t = useTranslations('automations');
  const { properties, isLoading: propsLoading } = useProperties();
  const [propertyId, setPropertyId] = useState('');
  const { data, error, isLoading, isValidating, mutate, toggleRuleStatus, addCleanerDelayedRule } =
    useAutomationRules('operations', propertyId || null);
  const [sheetRule, setSheetRule] = useState<AutomationRule | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [creatingKey, setCreatingKey] = useState<string | null>(null);

  useEffect(() => {
    const first = properties[0];
    if (!propertyId && first) setPropertyId(first.id);
  }, [properties, propertyId]);

  const openSheet = useCallback((rule: AutomationRule) => {
    setSheetRule(rule);
    setSheetOpen(true);
  }, []);

  const onToggleStatus = useCallback(
    async (rule: AutomationRule, nextActive: boolean) => {
      const nextStatus = nextActive ? 'active' : 'inactive';
      try {
        await toggleRuleStatus(rule.id, nextStatus);
      } catch {
        toast.error(t('rules.toggleError'));
      }
    },
    [toggleRuleStatus, t],
  );

  const onCreateFromTemplate = useCallback(
    async (ruleKey: string) => {
      if (!propertyId || ruleKey !== 'CLEANER_DELAYED') return;
      setCreatingKey(ruleKey);
      try {
        await addCleanerDelayedRule();
        toast.success(t('operations.addRuleSuccess'));
      } catch (e) {
        if (isAxiosError(e) && e.response?.status === 409) {
          toast.error(t('operations.addRuleConflict'));
          await mutate();
        } else {
          toast.error(t('operations.addRuleError'));
        }
      } finally {
        setCreatingKey(null);
      }
    },
    [propertyId, addCleanerDelayedRule, mutate, t],
  );

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('operations.title')}</h1>
        <Alert variant="destructive">
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{t('operations.loadError')}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void mutate()}>
              {t('operations.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('operations.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('operations.subtitle')}</p>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('operations.catalogHint')}</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-900/80">
        <div className="max-w-md space-y-2">
          <Label htmlFor="automations-property">{t('operations.propertyLabel')}</Label>
          <Select
            id="automations-property"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            disabled={propsLoading || properties.length === 0}
          >
            <option value="">{propsLoading ? t('operations.loadingProperties') : t('operations.pickProperty')}</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.id}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {!propertyId ? (
        <p className="text-sm text-muted-foreground">{t('operations.selectPropertyHint')}</p>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {OPERATIONS_RULE_TEMPLATES.map((tm) => (
            <RuleCardSkeleton key={tm.ruleKey} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {OPERATIONS_RULE_TEMPLATES.map((template) => {
            const rule = data?.find((r) => r.key === template.ruleKey);
            if (rule) {
              return (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  onEdit={openSheet}
                  onToggleStatus={onToggleStatus}
                  toggleDisabled={isValidating}
                />
              );
            }
            return (
              <OperationsCatalogCard
                key={template.ruleKey}
                template={template}
                isCreating={creatingKey === template.ruleKey}
                onEnable={
                  template.creatable && template.ruleKey === 'CLEANER_DELAYED'
                    ? () => void onCreateFromTemplate(template.ruleKey)
                    : undefined
                }
              />
            );
          })}
        </div>
      )}

      <RuleSettingsSheet
        rule={sheetRule}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setSheetRule(null);
        }}
        onSaved={async () => {
          await mutate();
        }}
      />
    </div>
  );
}
