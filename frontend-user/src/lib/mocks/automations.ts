import type { AutomationCategory, AutomationRule, RuleStatus } from '@/types/automations';

const initialOperationsRules: AutomationRule[] = [
  {
    id: 'op-1',
    key: 'CLEANER_DELAYED',
    category: 'operations',
    status: 'active',
    titleKey: 'rules.cleanerDelayed.title',
    descriptionKey: 'rules.cleanerDelayed.description',
    params: { notifyManager: true, delayThreshold: 45, fallbackGroupId: 'backup-cleaners' },
  },
  {
    id: 'op-2',
    key: 'TURNOVER_BUFFER_LOW',
    category: 'operations',
    status: 'active',
    titleKey: 'rules.turnoverBuffer.title',
    descriptionKey: 'rules.turnoverBuffer.description',
    params: { notifyManager: true, delayThreshold: 120, minBufferMinutes: 90 },
  },
  {
    id: 'op-3',
    key: 'LINEN_SHORTAGE_PREDICTED',
    category: 'operations',
    status: 'inactive',
    titleKey: 'rules.linenShortage.title',
    descriptionKey: 'rules.linenShortage.description',
    params: { notifyManager: false, delayThreshold: 30 },
  },
  {
    id: 'op-4',
    key: 'DRIVER_NO_SHOW',
    category: 'operations',
    status: 'active',
    titleKey: 'rules.driverNoShow.title',
    descriptionKey: 'rules.driverNoShow.description',
    params: { notifyManager: true, delayThreshold: 15, reassignPool: 'drivers-night' },
  },
];

let rulesStore: AutomationRule[] = initialOperationsRules.map((r) => ({ ...r }));

function mockFailEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AUTOMATIONS_MOCK_PATCH_FAIL?.trim() === '1';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function getAutomationRulesByCategory(category: AutomationCategory): AutomationRule[] {
  return rulesStore.filter((r) => r.category === category).map((r) => ({ ...r }));
}

export async function fetchAutomationRulesByCategory(category: AutomationCategory): Promise<AutomationRule[]> {
  await delay(280);
  return getAutomationRulesByCategory(category);
}

export async function patchAutomationRuleStatus(ruleId: string, status: RuleStatus): Promise<void> {
  await delay(320);
  if (mockFailEnabled()) {
    throw new Error('AUTOMATIONS_MOCK_PATCH_FAILED');
  }
  const idx = rulesStore.findIndex((r) => r.id === ruleId);
  if (idx === -1) {
    throw new Error('AUTOMATIONS_RULE_NOT_FOUND');
  }
  rulesStore = rulesStore.map((r, i) => (i === idx ? { ...r, status } : r));
}

export async function patchAutomationRuleParams(
  ruleId: string,
  params: Record<string, unknown>,
): Promise<void> {
  await delay(250);
  if (mockFailEnabled()) {
    throw new Error('AUTOMATIONS_MOCK_PATCH_FAILED');
  }
  const idx = rulesStore.findIndex((r) => r.id === ruleId);
  if (idx === -1) {
    throw new Error('AUTOMATIONS_RULE_NOT_FOUND');
  }
  rulesStore = rulesStore.map((r, i) => (i === idx ? { ...r, params: { ...r.params, ...params } } : r));
}
