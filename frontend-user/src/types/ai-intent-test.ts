/** Response from `POST /api/v1/ai-chat/test-intent` — mirrors backend dry-run shape. */
export type IntentTestExample = {
  id: string;
  label: string;
  senderRole: 'GUEST' | 'STAFF' | 'SYSTEM' | 'MANAGER';
  text: string;
};

export type IntentTestDryRunResult = {
  input: {
    propertyId: string;
    senderId: string;
    senderRole: string;
    channel: string;
    textLength: number;
  };
  activeAutomationRulesCount: number;
  skipActiveRulesGate: boolean;
  stoppedAt:
    | null
    | 'sender_role_excluded'
    | 'message_too_short'
    | 'no_active_automation_rules'
    | 'no_llm_api_key';
  llm: null | {
    model: string;
    latencyMs: number;
    intentKey: string;
    extractedData: Record<string, unknown>;
  };
  llmError: null | { message: string; status?: number };
  wouldEmitAiIntentDetected: boolean;
  emitPayloadValid: boolean;
  emitPayloadError: string | null;
  matchingActiveRule: null | { id: string; key: string };
  automationExecutorImplemented: boolean;
  summary: string;
};
