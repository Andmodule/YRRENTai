/** Dot-paths under the `automations` next-intl namespace (e.g. `rules.cleanerDelayed.title`). */
export type AutomationRoadmapTemplate = {
  /** Stable event / rule key from the product dictionary. */
  ruleKey: string;
  titleKey: string;
  descriptionKey: string;
  /** If true, UI may offer “enable” when backend supports creation. */
  creatable: boolean;
};
