export type RuleStatus = 'active' | 'inactive';

export type AutomationCategory =
  | 'operations'
  | 'guests'
  | 'smart-home'
  | 'revenue'
  | 'support';

/** Keys under the `automations` next-intl namespace. */
export type AutomationsRuleTitleKey =
  | 'rules.cleanerDelayed.title'
  | 'rules.turnoverBuffer.title'
  | 'rules.linenShortage.title'
  | 'rules.driverNoShow.title'
  | 'rules.generic.title';

export type AutomationsRuleDescriptionKey =
  | 'rules.cleanerDelayed.description'
  | 'rules.turnoverBuffer.description'
  | 'rules.linenShortage.description'
  | 'rules.driverNoShow.description'
  | 'rules.generic.description';

export interface AutomationRule {
  id: string;
  key: string;
  category: AutomationCategory;
  status: RuleStatus;
  titleKey: AutomationsRuleTitleKey;
  descriptionKey: AutomationsRuleDescriptionKey;
  params: Record<string, unknown>;
}
