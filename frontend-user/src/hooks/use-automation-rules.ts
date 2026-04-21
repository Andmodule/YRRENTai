'use client';

import useSWR from 'swr';
import type { AutomationCategory, AutomationRule, RuleStatus } from '@/types/automations';
import {
  createCleanerDelayedRule,
  fetchAutomationRules,
  patchAutomationRuleStatusApi,
} from '@/lib/api/automations';

export function automationRulesSwrKey(
  category: AutomationCategory,
  propertyId: string,
): readonly ['automations/rules', AutomationCategory, string] {
  return ['automations/rules', category, propertyId] as const;
}

export function useAutomationRules(category: AutomationCategory, propertyId: string | null) {
  const key = propertyId ? automationRulesSwrKey(category, propertyId) : null;
  const swr = useSWR<AutomationRule[]>(
    key,
    () => fetchAutomationRules(propertyId!, category),
    {
      revalidateOnFocus: false,
    },
  );

  const toggleRuleStatus = async (ruleId: string, nextStatus: RuleStatus) => {
    await swr.mutate(
      async (current) => {
        await patchAutomationRuleStatusApi(ruleId, nextStatus);
        if (!current) return current;
        return current.map((r) => (r.id === ruleId ? { ...r, status: nextStatus } : r));
      },
      {
        optimisticData: (current) => {
          if (!current) return [];
          return current.map((r) => (r.id === ruleId ? { ...r, status: nextStatus } : r));
        },
        rollbackOnError: true,
        populateCache: true,
        revalidate: false,
        throwOnError: true,
      },
    );
  };

  const addCleanerDelayedRule = async () => {
    if (!propertyId) throw new Error('NO_PROPERTY');
    const created = await createCleanerDelayedRule(propertyId);
    await swr.mutate(
      (current) => {
        if (!current) return [created];
        if (current.some((r) => r.id === created.id)) return current;
        return [...current, created].sort((a, b) => a.key.localeCompare(b.key));
      },
      { revalidate: false },
    );
    return created;
  };

  return { ...swr, toggleRuleStatus, addCleanerDelayedRule, swrKey: key };
}
