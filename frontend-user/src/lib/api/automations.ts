import { apiClient } from '@/lib/api/client';
import type {
  AutomationCategory,
  AutomationRule,
  AutomationsRuleDescriptionKey,
  AutomationsRuleTitleKey,
  RuleStatus,
} from '@/types/automations';

export type AutomationRuleEntityDto = {
  id: string;
  propertyId: string;
  key: string;
  category: string;
  status: RuleStatus;
  params: Record<string, unknown>;
};

const RULE_UI: Record<
  string,
  { titleKey: AutomationsRuleTitleKey; descriptionKey: AutomationsRuleDescriptionKey }
> = {
  CLEANER_DELAYED: {
    titleKey: 'rules.cleanerDelayed.title',
    descriptionKey: 'rules.cleanerDelayed.description',
  },
};

export function mapAutomationRuleFromApi(row: AutomationRuleEntityDto): AutomationRule {
  const ui = RULE_UI[row.key];
  if (ui) {
    return {
      id: row.id,
      key: row.key,
      category: row.category as AutomationCategory,
      status: row.status,
      ...ui,
      params: row.params ?? {},
    };
  }
  return {
    id: row.id,
    key: row.key,
    category: row.category as AutomationCategory,
    status: row.status,
    titleKey: 'rules.generic.title',
    descriptionKey: 'rules.generic.description',
    params: row.params ?? {},
  };
}

export async function fetchAutomationRules(
  propertyId: string,
  category: AutomationCategory,
): Promise<AutomationRule[]> {
  const res = await apiClient.get<{ data: AutomationRuleEntityDto[] }>('/automations/rules', {
    params: { propertyId, category },
  });
  return res.data.data.map(mapAutomationRuleFromApi);
}

export async function createCleanerDelayedRule(propertyId: string): Promise<AutomationRule> {
  const res = await apiClient.post<{ data: AutomationRuleEntityDto }>('/automations/rules', {
    propertyId,
    key: 'CLEANER_DELAYED',
    category: 'operations',
    status: 'active',
  });
  return mapAutomationRuleFromApi(res.data.data);
}

export async function patchAutomationRuleStatusApi(ruleId: string, status: RuleStatus): Promise<void> {
  await apiClient.patch(`/automations/rules/${encodeURIComponent(ruleId)}/status`, { status });
}

export async function patchAutomationRuleParamsApi(
  ruleId: string,
  params: Record<string, unknown>,
): Promise<void> {
  await apiClient.patch(`/automations/rules/${encodeURIComponent(ruleId)}/params`, { params });
}
