import { apiClient } from '@/lib/api/client';
import type { IntentTestDryRunResult, IntentTestExample } from '@/types/ai-intent-test';

export async function fetchIntentTestExamples(): Promise<IntentTestExample[]> {
  const res = await apiClient.get<{ data: IntentTestExample[] }>('/ai-chat/test-intent/examples');
  return res.data.data;
}

export type IntentTestRequestBody = {
  propertyId: string;
  senderRole: IntentTestExample['senderRole'];
  text: string;
  skipActiveRulesGate?: boolean;
};

export async function postIntentTest(body: IntentTestRequestBody): Promise<IntentTestDryRunResult> {
  const res = await apiClient.post<{ data: IntentTestDryRunResult }>('/ai-chat/test-intent', {
    propertyId: body.propertyId,
    senderRole: body.senderRole,
    text: body.text,
    skipActiveRulesGate: body.skipActiveRulesGate ?? true,
  });
  return res.data.data;
}
