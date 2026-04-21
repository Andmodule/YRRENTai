import type { AutomationRoadmapTemplate } from './automation-roadmap-template';

/** Static catalog: what operations automations *can* look like; DB row optional per property. */
export type OperationsRuleTemplate = AutomationRoadmapTemplate;

export const OPERATIONS_RULE_TEMPLATES: readonly OperationsRuleTemplate[] = [
  {
    ruleKey: 'CLEANER_DELAYED',
    titleKey: 'rules.cleanerDelayed.title',
    descriptionKey: 'rules.cleanerDelayed.description',
    creatable: true,
  },
  {
    ruleKey: 'TURNOVER_BUFFER_LOW',
    titleKey: 'rules.turnoverBuffer.title',
    descriptionKey: 'rules.turnoverBuffer.description',
    creatable: false,
  },
  {
    ruleKey: 'LINEN_SHORTAGE_PREDICTED',
    titleKey: 'rules.linenShortage.title',
    descriptionKey: 'rules.linenShortage.description',
    creatable: false,
  },
  {
    ruleKey: 'DRIVER_NO_SHOW',
    titleKey: 'rules.driverNoShow.title',
    descriptionKey: 'rules.driverNoShow.description',
    creatable: false,
  },
] as const;
