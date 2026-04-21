import { z } from 'zod';

/** Incoming `ai.intent.detected` event — validated before any side effects. */
export const AiIntentDetectedSchema = z.object({
  /** External message id, trace id, or broker idempotency key (not necessarily UUID). */
  eventId: z.string().min(1),
  propertyId: z.string().uuid(),
  /** Matches `AutomationRuleEntity.key` (e.g. CLEANER_DELAYED). */
  intentKey: z.string().min(1),
  /** Staff / external actor id (Telegram, WhatsApp, internal user id, …). */
  triggerUserId: z.string().min(1),
  /** Raw structured output from the LLM layer; `{}` is valid (e.g. FAQ_*, LUGGAGE_STORAGE, NONE). */
  extractedData: z.record(z.string(), z.unknown()),
});

export type AiIntentDetectedPayload = z.infer<typeof AiIntentDetectedSchema>;
