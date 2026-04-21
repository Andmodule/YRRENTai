import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import type { Job } from 'bullmq';
import OpenAI from 'openai';
import { Repository } from 'typeorm';
import { z } from 'zod';
import { isAutomationExecutorImplemented } from '../automations/automations.constants';
import { AutomationRuleEntity } from '../automations/entities/automation-rule.entity';
import { AiIntentDetectedSchema } from '../automations/events/ai-intent.payload';
import {
  ChatMessageSavedEventSchema,
  type ChatMessageSavedEvent,
} from './events/chat-message-saved.event';

const LLM_TIMEOUT_MS = 5000;

const LLM_INTENT_KEYS = [
  'CLEANER_DELAYED',
  'MAINTENANCE_REPORTED',
  'GUEST_EARLY_CHECKOUT',
  'LATE_CHECKOUT_REQUEST',
  'EARLY_CHECKIN_REQUEST',
  'LUGGAGE_STORAGE',
  'FAQ_WIFI',
  'FAQ_PARKING',
  'NONE',
] as const;

/** Parsed LLM body (schema enforced in prompt + validated here). */
const LlmIntentResponseSchema = z.object({
  intentKey: z.enum(LLM_INTENT_KEYS),
  extractedData: z.record(z.string(), z.unknown()).default({}),
});

export type AiIntentDryRunResult = {
  input: Pick<ChatMessageSavedEvent, 'propertyId' | 'senderId' | 'senderRole' | 'channel'> & {
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
  /** Same checks as production before `emit('ai.intent.detected')` */
  wouldEmitAiIntentDetected: boolean;
  emitPayloadValid: boolean;
  emitPayloadError: string | null;
  matchingActiveRule: null | { id: string; key: string };
  /** Whether `AutomationsService` has code for this rule key */
  automationExecutorImplemented: boolean;
  /** Short hint for humans */
  summary: string;
};

function getErrorHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const o = error as { status?: unknown; cause?: unknown };
  if (typeof o.status === 'number') return o.status;
  if (typeof o.cause === 'object' && o.cause !== null && 'status' in o.cause) {
    const s = (o.cause as { status?: unknown }).status;
    if (typeof s === 'number') return s;
  }
  return undefined;
}

type GateResult =
  | {
      proceed: false;
      reason: Exclude<AiIntentDryRunResult['stoppedAt'], null>;
      activeRulesCount: number;
    }
  | { proceed: true; activeRulesCount: number };

@Processor('ai-intent-extraction', {
  concurrency: 5,
  limiter: {
    max: 10,
    duration: 1000,
  },
})
@Injectable()
export class AiExtractorService extends WorkerHost {
  private readonly logger = new Logger(AiExtractorService.name);
  private readonly openai: OpenAI | null;

  constructor(
    @InjectRepository(AutomationRuleEntity)
    private readonly automationRuleRepository: Repository<AutomationRuleEntity>,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
    const apiKey = this.resolveLlmApiKey();
    const baseURL = this.resolveLlmBaseUrl();
    this.openai = apiKey
      ? new OpenAI({
          apiKey,
          baseURL,
          timeout: LLM_TIMEOUT_MS,
          maxRetries: 0,
        })
      : null;
    if (!this.openai) {
      this.logger.warn(
        '[AiExtractor] OpenAI client not created: set DEEPSEEK_API_KEY or OPENAI_API_KEY for AI_PROVIDER',
      );
    }
  }

  async process(job: Job<ChatMessageSavedEvent>): Promise<void> {
    const parsedEvt = ChatMessageSavedEventSchema.safeParse(job.data);
    if (!parsedEvt.success) {
      this.logger.warn(`[AiExtractor] Ignored invalid job data: ${parsedEvt.error.message}`);
      return;
    }
    const payload = parsedEvt.data;

    const gate = await this.evaluateExtractionGate(payload, { skipActiveRulesGate: false });
    if (!gate.proceed) {
      return;
    }

    try {
      const llm = await this.invokeLlmIntentModel(payload);
      if (!llm.ok) {
        if (llm.kind === 'empty') this.logger.warn('[AiExtractor] Empty LLM content');
        if (llm.kind === 'json') this.logger.error('[AiExtractor] AI hallucination: response is not valid JSON');
        if (llm.kind === 'shape')
          this.logger.error('[AiExtractor] AI hallucination: JSON shape invalid');
        if (llm.kind === 'http')
          this.logger.error(`[AiExtractor] Failed: ${llm.message}`);
        return;
      }

      this.logger.log(
        `[AiExtractor] Latency: ${Math.round(llm.latencyMs)}ms | Intent: ${llm.intentKey}`,
      );

      if (llm.intentKey === 'NONE') {
        return;
      }

      const emitPayload = {
        eventId: payload.messageId,
        propertyId: payload.propertyId,
        intentKey: llm.intentKey,
        triggerUserId: payload.senderId,
        extractedData: llm.extractedData,
      };

      const validated = AiIntentDetectedSchema.safeParse(emitPayload);
      if (!validated.success) {
        this.logger.error(`[AiExtractor] Payload failed AiIntentDetectedSchema: ${validated.error.message}`);
        return;
      }

      this.eventEmitter.emit('ai.intent.detected', validated.data);
      this.logger.log(
        `[AiExtractor] Emitted ai.intent.detected intentKey=${llm.intentKey} eventId=${payload.messageId}`,
      );
    } catch (error: unknown) {
      if (getErrorHttpStatus(error) === 429) {
        this.logger.warn(`[AiExtractor] Rate limit hit for job ${job.id}. BullMQ will retry.`);
        throw error;
      }
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[AiExtractor] Failed: ${msg}`, error instanceof Error ? error.stack : undefined);
    }
  }

  /**
   * Same classification path as the Bull worker, without persisting chat or emitting `ai.intent.detected`.
   * Used by `AiIntentTestController` for manual / QA checks.
   */
  async dryRunIntentExtraction(
    payload: ChatMessageSavedEvent,
    options: { skipActiveRulesGate: boolean },
  ): Promise<AiIntentDryRunResult> {
    const skipActiveRulesGate = options.skipActiveRulesGate;
    const base: Omit<AiIntentDryRunResult, 'stoppedAt' | 'llm' | 'llmError' | 'summary'> = {
      input: {
        propertyId: payload.propertyId,
        senderId: payload.senderId,
        senderRole: payload.senderRole,
        channel: payload.channel,
        textLength: payload.text.length,
      },
      activeAutomationRulesCount: 0,
      skipActiveRulesGate,
      wouldEmitAiIntentDetected: false,
      emitPayloadValid: false,
      emitPayloadError: null,
      matchingActiveRule: null,
      automationExecutorImplemented: false,
    };

    const gate = await this.evaluateExtractionGate(payload, { skipActiveRulesGate });
    base.activeAutomationRulesCount = gate.activeRulesCount;

    if (!gate.proceed) {
      const summary = this.dryRunSummaryForStopped(gate.reason);
      return { ...base, stoppedAt: gate.reason, llm: null, llmError: null, summary };
    }

    const llm = await this.invokeLlmIntentModel(payload);
    if (!llm.ok) {
      const llmError =
        llm.kind === 'http'
          ? { message: llm.message, status: llm.status }
          : { message: llm.kind === 'empty' ? 'Empty LLM content' : 'Invalid LLM JSON or shape' };
      const summary = `LLM call failed: ${llmError.message}`;
      return { ...base, stoppedAt: null, llm: null, llmError, summary };
    }

    const emitPayload = {
      eventId: payload.messageId,
      propertyId: payload.propertyId,
      intentKey: llm.intentKey,
      triggerUserId: payload.senderId,
      extractedData: llm.extractedData,
    };
    const validated = AiIntentDetectedSchema.safeParse(emitPayload);
    const emitPayloadValid = validated.success;
    const emitPayloadError = validated.success ? null : validated.error.message;

    const wouldEmit = llm.intentKey !== 'NONE' && emitPayloadValid;

    let matchingActiveRule: AiIntentDryRunResult['matchingActiveRule'] = null;
    let automationExecutorImplemented = false;
    if (llm.intentKey !== 'NONE') {
      const rule = await this.automationRuleRepository.findOne({
        where: { propertyId: payload.propertyId, key: llm.intentKey, status: 'active' },
      });
      if (rule) {
        matchingActiveRule = { id: rule.id, key: rule.key };
        automationExecutorImplemented = isAutomationExecutorImplemented(rule.key);
      }
    }

    const out: AiIntentDryRunResult = {
      ...base,
      stoppedAt: null,
      llm: {
        model: llm.model,
        latencyMs: Math.round(llm.latencyMs),
        intentKey: llm.intentKey,
        extractedData: llm.extractedData,
      },
      llmError: null,
      wouldEmitAiIntentDetected: wouldEmit,
      emitPayloadValid,
      emitPayloadError,
      matchingActiveRule,
      automationExecutorImplemented,
      summary: '',
    };
    out.summary = this.dryRunSummaryForSuccess(out);
    return out;
  }

  private dryRunSummaryForStopped(
    reason: NonNullable<AiIntentDryRunResult['stoppedAt']>,
  ): string {
    if (reason === 'sender_role_excluded') return 'Worker would skip: sender role SYSTEM/MANAGER.';
    if (reason === 'message_too_short') return 'Worker would skip: message shorter than 5 characters.';
    if (reason === 'no_active_automation_rules')
      return 'Worker would skip: no active automation rules for property (use skipActiveRulesGate=true in test body to call LLM anyway).';
    return 'LLM client not configured (missing API keys).';
  }

  private dryRunSummaryForSuccess(p: AiIntentDryRunResult): string {
    if (!p.llm) return 'No LLM result.';
    if (p.llm.intentKey === 'NONE')
      return `Intent NONE (${p.llm.latencyMs} ms) — production would not emit ai.intent.detected.`;
    if (!p.emitPayloadValid)
      return `Intent ${p.llm.intentKey} but emit payload failed Zod: ${p.emitPayloadError ?? ''}`;
    if (!p.matchingActiveRule)
      return `Would emit ai.intent.detected (${p.llm.intentKey}), but no active automation rule for this property — AutomationsService would no-op.`;
    if (!p.automationExecutorImplemented)
      return `Would emit and match rule ${p.matchingActiveRule.key}, but no executor implemented in AutomationsService yet.`;
    return `Would emit ai.intent.detected and run automation for ${p.matchingActiveRule.key} (${p.llm.latencyMs} ms).`;
  }

  private async evaluateExtractionGate(
    payload: ChatMessageSavedEvent,
    options: { skipActiveRulesGate: boolean },
  ): Promise<GateResult> {
    const activeRulesCount = await this.automationRuleRepository.count({
      where: { propertyId: payload.propertyId, status: 'active' },
    });

    if (payload.senderRole === 'SYSTEM' || payload.senderRole === 'MANAGER') {
      return { proceed: false, reason: 'sender_role_excluded', activeRulesCount };
    }
    if (payload.text.trim().length < 5) {
      return { proceed: false, reason: 'message_too_short', activeRulesCount };
    }
    if (!options.skipActiveRulesGate && activeRulesCount === 0) {
      return { proceed: false, reason: 'no_active_automation_rules', activeRulesCount };
    }
    if (!this.openai) {
      return { proceed: false, reason: 'no_llm_api_key', activeRulesCount };
    }
    return { proceed: true, activeRulesCount };
  }

  private async invokeLlmIntentModel(
    payload: ChatMessageSavedEvent,
  ): Promise<
    | {
        ok: true;
        latencyMs: number;
        intentKey: string;
        extractedData: Record<string, unknown>;
        model: string;
      }
    | { ok: false; kind: 'empty' | 'json' | 'shape' }
    | { ok: false; kind: 'http'; status?: number; message: string }
  > {
    const model = this.resolveIntentExtractionModel();
    const userContent =
      `Sender Role: ${payload.senderRole}\nMessage: ${payload.text}\nPlease analyze this and output JSON.\nJSON`;

    try {
      const startTime = performance.now();
      const response = await this.openai!.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: this.getSystemPrompt() },
          { role: 'user', content: userContent },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 512,
      });
      const latency = performance.now() - startTime;

      const content = response.choices[0]?.message?.content ?? null;
      if (!content) {
        return { ok: false, kind: 'empty' };
      }

      let json: unknown;
      try {
        json = JSON.parse(content) as unknown;
      } catch {
        return { ok: false, kind: 'json' };
      }

      const parsed = LlmIntentResponseSchema.safeParse(json);
      if (!parsed.success) {
        return { ok: false, kind: 'shape' };
      }

      return {
        ok: true,
        latencyMs: latency,
        intentKey: parsed.data.intentKey,
        extractedData: parsed.data.extractedData,
        model,
      };
    } catch (error: unknown) {
      if (getErrorHttpStatus(error) === 429) {
        throw error;
      }
      const status = getErrorHttpStatus(error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, kind: 'http', status, message: msg };
    }
  }

  private getSystemPrompt(): string {
    return `You are an AI Intent Extractor for RentAI, a Property Management System.
Your task is to analyze messages from guests or staff and classify them into a specific SYSTEM_INTENT.
You MUST output valid JSON only.

AVAILABLE INTENTS:
1. "CLEANER_DELAYED" - Staff reports they will take longer than expected.
2. "MAINTENANCE_REPORTED" - Guest/staff reports a broken item (e.g., AC, plumbing, Wi-Fi).
3. "GUEST_EARLY_CHECKOUT" - Guest states they are leaving earlier than scheduled.
4. "LATE_CHECKOUT_REQUEST" - Guest asks to stay past the standard checkout time.
5. "EARLY_CHECKIN_REQUEST" - Guest asks to arrive before the standard check-in time.
6. "LUGGAGE_STORAGE" - Guest asks if they can leave their bags before check-in or after check-out.
7. "FAQ_WIFI" - Guest asks for the Wi-Fi password or network name.
8. "FAQ_PARKING" - Guest asks about parking availability or location.
9. "NONE" - Small talk, "thank you", "ok", or unrecognized intent.

DISAMBIGUATION (apply when two labels could fit):
- Wi-Fi: password / SSID / "how do I connect" → FAQ_WIFI. Not working, no internet, broken router → MAINTENANCE_REPORTED.
- Parking: where to park, cost, guest spots → FAQ_PARKING. Broken gate or unsafe structure → MAINTENANCE_REPORTED.
- Bags: leaving bags before/after stay, locker → LUGGAGE_STORAGE. Only asking to enter the unit earlier → EARLY_CHECKIN_REQUEST.
- If several intents apply, choose the single PRIMARY operational intent (prefer explicit fault/report over FAQ).

OUTPUT FORMAT (JSON):
{
  "intentKey": "ONE_OF_THE_INTENTS_ABOVE",
  "extractedData": {
     // For CLEANER_DELAYED: "delayMinutes" (number, required), "reason" (string)
     // For MAINTENANCE_REPORTED: "issueItem" (string), "urgency" ("HIGH"|"LOW")
     // For GUEST_EARLY_CHECKOUT: "checkoutTime" (string HH:MM)
     // For EARLY_CHECKIN_REQUEST / LATE_CHECKOUT_REQUEST: "requestedTime" (string HH:MM)
     // For LUGGAGE_STORAGE / FAQ_*: leave empty {}
     // For NONE: leave empty {}
  }
}`;
  }

  /** Chat model follows `AI_PROVIDER` only (no separate model env). */
  private resolveIntentExtractionModel(): string {
    const prov = this.configService.get<string>('AI_PROVIDER') ?? 'deepseek';
    return prov === 'openai' ? 'gpt-4o-mini' : 'deepseek-chat';
  }

  private resolveLlmApiKey(): string | undefined {
    const prov = this.configService.get<string>('AI_PROVIDER') ?? 'deepseek';
    return (
      (prov === 'openai'
        ? this.configService.get<string>('OPENAI_API_KEY')?.trim()
        : this.configService.get<string>('DEEPSEEK_API_KEY')?.trim()) ||
      this.configService.get<string>('OPENAI_API_KEY')?.trim() ||
      this.configService.get<string>('DEEPSEEK_API_KEY')?.trim()
    );
  }

  private resolveLlmBaseUrl(): string {
    const prov = this.configService.get<string>('AI_PROVIDER') ?? 'deepseek';
    if (prov === 'openai') {
      return 'https://api.openai.com/v1';
    }
    const deepseek = this.configService.get<string>('DEEPSEEK_BASE_URL')?.replace(/\/$/, '') || 'https://api.deepseek.com';
    return `${deepseek}/v1`;
  }
}
