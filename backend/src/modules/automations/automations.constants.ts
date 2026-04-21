/** Lease while `handleAiIntentExecution` runs — **milliseconds** (`SET … PX … NX`). */
export const AUTOMATION_IDEMPOTENCY_PROCESSING_TTL_MS = 60_000;

/** Completed dedupe window — **milliseconds** (24h). */
export const AUTOMATION_IDEMPOTENCY_DONE_TTL_MS = 86_400_000;

/** Rule keys with a real branch in `AutomationsService.executeActionRouter` (keep in sync when adding handlers). */
export const AUTOMATION_RULE_KEYS_WITH_EXECUTOR = ['CLEANER_DELAYED'] as const;

export function isAutomationExecutorImplemented(ruleKey: string): boolean {
  return (AUTOMATION_RULE_KEYS_WITH_EXECUTOR as readonly string[]).includes(ruleKey);
}
