import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import { VoiceKbService } from './voice-kb.service';
import { VoicePolicyService } from './voice-policy.service';
import { PropertyVoicePolicyService } from './property-voice-policy.service';
import { VoiceSessionService } from './voice-session.service';
import { CallTranscriptSegmentEntity } from './entities/call-transcript-segment.entity';
import { getSafeResponse } from './voice-safe-responses';
import type { PolicyDecision } from './voice-policy.service';

export interface OrchestratorTurnInput {
  sessionId: string;
  propertyId: string | null;
  reservationId: string | null;
  guestQuery: string;
  language: string;
  turnIndex: number;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Provider-assigned utterance ID for deduplication */
  providerSegmentId?: string;
}

export interface OrchestratorTurnResult {
  answer: string;
  intent: string;
  confidence: number;
  shouldEscalate: boolean;
  shouldTransferNow: boolean;
  escalationReason: string | null;
  kbSources: string[];
  /** Total end-to-end latency ms */
  latencyMs: number;
  policyDecision: PolicyDecision;
  /** Breakdown for observability */
  breakdown: {
    retrievalMs: number;
    llmMs: number;
  };
}

interface LlmStructuredOutput {
  intent: string;
  answer: string;
  confidence: number;
  shouldEscalate: boolean;
  shouldTransferNow: boolean;
  requiresHumanApproval: boolean;
  kbSources: string[];
  language: string;
  reason: string;
}

const SYSTEM_PROMPT_TEMPLATE = `
Ты — голосовой ассистент для сервиса краткосрочной аренды. Отвечай кратко, разговорным языком — не длиннее 2-3 предложений.
Используй предоставленный контекст объекта и базу знаний. Если не знаешь точного ответа — честно скажи.

ВАЖНО: Отвечай ТОЛЬКО JSON в точной схеме ниже (без markdown-обёртки):
{
  "intent": "<одно из: checkin|checkout|wifi|parking|address|deposit|early_checkin|late_checkout|emergency|complaint|transfer_request|other>",
  "answer": "<текст ответа для гостя, не длиннее 2-3 предложений>",
  "confidence": <0.0–1.0>,
  "shouldEscalate": <true|false>,
  "shouldTransferNow": <true|false>,
  "requiresHumanApproval": <true|false>,
  "kbSources": [<id строк из базы знаний, использованных в ответе>],
  "language": "<ru|en>",
  "reason": "<краткое внутреннее пояснение>"
}

КОНТЕКСТ ОБЪЕКТА:
{{PROPERTY_CONTEXT}}

БАЗА ЗНАНИЙ:
{{KB_CONTEXT}}

ИНФОРМАЦИЯ О БРОНИ:
{{RESERVATION_CONTEXT}}
`.trim();

@Injectable()
export class VoiceOrchestratorService {
  private readonly logger = new Logger(VoiceOrchestratorService.name);
  private readonly llm: OpenAI;

  constructor(
    private readonly config: ConfigService,
    private readonly kbService: VoiceKbService,
    private readonly policyService: VoicePolicyService,
    private readonly propertyPolicyService: PropertyVoicePolicyService,
    private readonly sessionService: VoiceSessionService,
    @InjectRepository(CallTranscriptSegmentEntity)
    private readonly segmentRepo: Repository<CallTranscriptSegmentEntity>,
  ) {
    const provider = this.config.get<string>('AI_PROVIDER', 'deepseek');
    const apiKey =
      provider === 'openai'
        ? (this.config.get<string>('OPENAI_API_KEY') ?? '')
        : (this.config.get<string>('DEEPSEEK_API_KEY') ?? '');
    const baseURL =
      provider === 'openai'
        ? 'https://api.openai.com/v1'
        : this.config.get<string>('DEEPSEEK_BASE_URL', 'https://api.deepseek.com');

    this.llm = new OpenAI({ apiKey, baseURL });
  }

  async processTurn(input: OrchestratorTurnInput): Promise<OrchestratorTurnResult> {
    const turnStartedAt = new Date();
    const t0 = Date.now();

    // ── Duplicate detection via providerSegmentId ─────────────────────────
    if (input.providerSegmentId) {
      const dup = await this.segmentRepo.findOne({
        where: { providerSegmentId: input.providerSegmentId },
      });
      if (dup) {
        this.logger.debug(`Duplicate segment ${input.providerSegmentId} — skipped`);
        return this.buildSkipResult(input.language, Date.now() - t0);
      }
    }

    // ── Save guest utterance ──────────────────────────────────────────────
    await this.saveSegment({
      sessionId: input.sessionId,
      turnIndex: input.turnIndex,
      role: 'guest',
      content: input.guestQuery,
      language: input.language,
      turnStartedAt,
      providerSegmentId: input.providerSegmentId,
    });

    // ── Load per-property policy ──────────────────────────────────────────
    const policy = input.propertyId
      ? await this.propertyPolicyService.getOrCreatePolicy(input.propertyId)
      : this.defaultPolicy();

    // ── Phase 1: pre-LLM guard ────────────────────────────────────────────
    const preEmption = this.policyService.evaluatePreLlm({
      guestQuery: input.guestQuery,
      language: input.language,
      policy,
      turnIndex: input.turnIndex,
    });

    if (preEmption) {
      const latencyMs = Date.now() - t0;
      const answer = preEmption.safeResponse ?? getSafeResponse('hold', input.language);
      await this.saveSegment({
        sessionId: input.sessionId,
        turnIndex: input.turnIndex,
        role: 'ai',
        content: answer,
        language: input.language,
        intent: preEmption.decision,
        confidence: 1.0,
        kbSources: [],
        triggeredEscalation: preEmption.shouldEscalate,
        turnStartedAt,
        firstAudioAt: new Date(),
        turnTotalMs: latencyMs,
      });
      await this.sessionService.appendEvent(
        input.sessionId,
        'emergency_guard',
        { decision: preEmption.decision, reason: preEmption.escalationReason },
      );
      await this.sessionService.incrementTurnCount(input.sessionId, latencyMs);
      return {
        answer,
        intent: preEmption.decision,
        confidence: 1.0,
        shouldEscalate: preEmption.shouldEscalate,
        shouldTransferNow: preEmption.shouldTransferNow,
        escalationReason: preEmption.escalationReason,
        kbSources: [],
        latencyMs,
        policyDecision: preEmption.decision,
        breakdown: { retrievalMs: 0, llmMs: 0 },
      };
    }

    // ── KB context retrieval ──────────────────────────────────────────────
    const r0 = Date.now();
    const bundle = await this.kbService.buildContextBundle({
      propertyId: input.propertyId,
      reservationId: input.reservationId,
      guestQuery: input.guestQuery,
    });
    const retrievalMs = Date.now() - r0;

    // ── LLM call with retry ───────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(bundle, policy.shortAnswerMode);
    const l0 = Date.now();
    let parsed: LlmStructuredOutput | null = null;
    let llmAttempts = 0;

    while (!parsed && llmAttempts < 2) {
      llmAttempts++;
      try {
        parsed = await this.callLlm(
          systemPrompt,
          input.conversationHistory,
          input.guestQuery,
          llmAttempts > 1,
        );
      } catch (err) {
        this.logger.error(`LLM attempt ${llmAttempts} failed: ${(err as Error).message}`);
      }
    }

    const llmMs = Date.now() - l0;
    const firstAudioAt = new Date();
    const latencyMs = Date.now() - t0;

    this.logger.log(
      `Turn ${input.turnIndex}: total=${latencyMs}ms retrieval=${retrievalMs}ms llm=${llmMs}ms (${llmAttempts} attempt(s))`,
    );

    if (!parsed) {
      // Circuit breaker
      const fallback = getSafeResponse('llm_failure', input.language);
      await this.saveSegment({
        sessionId: input.sessionId,
        turnIndex: input.turnIndex,
        role: 'ai',
        content: fallback,
        language: input.language,
        intent: 'other',
        confidence: 0,
        kbSources: [],
        triggeredEscalation: true,
        turnStartedAt,
        firstAudioAt,
        retrievalLatencyMs: retrievalMs,
        llmLatencyMs: llmMs,
        turnTotalMs: latencyMs,
      });
      await this.sessionService.appendEvent(input.sessionId, 'fallback_triggered', {
        reason: 'llm_parse_failure',
        attempts: llmAttempts,
      });
      await this.sessionService.incrementTurnCount(input.sessionId, latencyMs);
      return {
        answer: fallback,
        intent: 'other',
        confidence: 0,
        shouldEscalate: true,
        shouldTransferNow: false,
        escalationReason: 'llm_failure',
        kbSources: [],
        latencyMs,
        policyDecision: 'escalate',
        breakdown: { retrievalMs, llmMs },
      };
    }

    // ── Phase 2: post-LLM policy ──────────────────────────────────────────
    const postPolicy = this.policyService.evaluatePostLlm({
      guestQuery: input.guestQuery,
      confidence: parsed.confidence,
      language: input.language,
      policy,
      turnIndex: input.turnIndex,
    });

    const finalEscalate = parsed.shouldEscalate || postPolicy.shouldEscalate;
    const finalTransferNow = parsed.shouldTransferNow || postPolicy.shouldTransferNow;
    const finalReason = postPolicy.escalationReason ?? (finalEscalate ? 'ai_flagged' : null);
    const finalAnswer =
      postPolicy.safeResponse && postPolicy.shouldEscalate ? postPolicy.safeResponse : parsed.answer;

    await this.saveSegment({
      sessionId: input.sessionId,
      turnIndex: input.turnIndex,
      role: 'ai',
      content: finalAnswer,
      language: parsed.language ?? input.language,
      intent: parsed.intent,
      confidence: parsed.confidence,
      kbSources: parsed.kbSources,
      triggeredEscalation: finalEscalate,
      turnStartedAt,
      firstAudioAt,
      retrievalLatencyMs: retrievalMs,
      llmLatencyMs: llmMs,
      turnTotalMs: latencyMs,
    });

    const eventType = finalEscalate ? 'escalation_requested' : 'intent_detected';
    await this.sessionService.appendEvent(input.sessionId, eventType, {
      intent: parsed.intent,
      confidence: parsed.confidence,
      reason: finalReason,
      retrievalMs,
      llmMs,
      turnTotalMs: latencyMs,
    });

    await this.sessionService.incrementTurnCount(input.sessionId, latencyMs);

    return {
      answer: finalAnswer,
      intent: parsed.intent,
      confidence: parsed.confidence,
      shouldEscalate: finalEscalate,
      shouldTransferNow: finalTransferNow,
      escalationReason: finalReason,
      kbSources: parsed.kbSources,
      latencyMs,
      policyDecision: postPolicy.decision,
      breakdown: { retrievalMs, llmMs },
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private buildSystemPrompt(
    bundle: import('./voice-kb.service').VoiceContextBundle,
    shortAnswerMode: boolean,
  ): string {
    let prompt = SYSTEM_PROMPT_TEMPLATE
      .replace('{{PROPERTY_CONTEXT}}', bundle.propertyContext || 'Нет данных')
      .replace('{{KB_CONTEXT}}', bundle.kbContext || 'База знаний пуста')
      .replace('{{RESERVATION_CONTEXT}}', bundle.reservationContext || 'Бронь не найдена');

    if (shortAnswerMode) {
      prompt += '\n\nРЕЖИМ КОРОТКОГО ОТВЕТА: отвечай не длиннее 1-2 предложений.';
    }
    return prompt;
  }

  private async callLlm(
    systemPrompt: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    guestQuery: string,
    strictMode: boolean,
  ): Promise<LlmStructuredOutput | null> {
    const provider = this.config.get<string>('AI_PROVIDER', 'deepseek');
    const modelDefault = provider === 'openai' ? 'gpt-4o-mini' : 'deepseek-chat';
    const model = this.config.get<string>('VOICE_PARSE_LLM_MODEL', modelDefault);

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content:
          systemPrompt +
          (strictMode ? '\n\nОТВЕЧАЙ ТОЛЬКО ВАЛИДНЫМ JSON. НЕТ MARKDOWN.' : ''),
      },
      ...history,
      { role: 'user', content: guestQuery },
    ];

    const response = await this.llm.chat.completions.create({
      model,
      messages,
      temperature: 0.3,
      max_tokens: 512,
    });

    return this.parseStructuredOutput(response.choices[0]?.message?.content ?? '');
  }

  private parseStructuredOutput(raw: string): LlmStructuredOutput | null {
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleaned) as Partial<LlmStructuredOutput>;
      if (
        typeof parsed.answer === 'string' &&
        typeof parsed.confidence === 'number' &&
        typeof parsed.intent === 'string'
      ) {
        return {
          intent: parsed.intent,
          answer: parsed.answer,
          confidence: Math.min(1, Math.max(0, parsed.confidence)),
          shouldEscalate: Boolean(parsed.shouldEscalate),
          shouldTransferNow: Boolean(parsed.shouldTransferNow),
          requiresHumanApproval: Boolean(parsed.requiresHumanApproval),
          kbSources: Array.isArray(parsed.kbSources) ? (parsed.kbSources as string[]) : [],
          language: typeof parsed.language === 'string' ? parsed.language : 'ru',
          reason: typeof parsed.reason === 'string' ? parsed.reason : '',
        };
      }
      this.logger.warn('Structured output missing required fields', parsed);
      return null;
    } catch (e) {
      this.logger.warn(`JSON parse error: ${(e as Error).message}. Raw: ${raw.slice(0, 200)}`);
      return null;
    }
  }

  private async saveSegment(data: {
    sessionId: string;
    turnIndex: number;
    role: 'guest' | 'ai' | 'operator';
    content: string;
    language: string;
    intent?: string;
    confidence?: number;
    kbSources?: string[];
    triggeredEscalation?: boolean;
    turnStartedAt?: Date;
    firstAudioAt?: Date;
    sttLatencyMs?: number;
    retrievalLatencyMs?: number;
    llmLatencyMs?: number;
    ttsLatencyMs?: number;
    turnTotalMs?: number;
    providerSegmentId?: string;
  }): Promise<void> {
    try {
      const seg = this.segmentRepo.create({
        sessionId: data.sessionId,
        turnIndex: data.turnIndex,
        role: data.role,
        content: data.content,
        language: data.language,
        intent: data.intent ?? null,
        confidence: data.confidence ?? null,
        kbSources: data.kbSources ?? null,
        triggeredEscalation: data.triggeredEscalation ?? false,
        turnStartedAt: data.turnStartedAt ?? null,
        firstAudioAt: data.firstAudioAt ?? null,
        sttLatencyMs: data.sttLatencyMs ?? null,
        retrievalLatencyMs: data.retrievalLatencyMs ?? null,
        llmLatencyMs: data.llmLatencyMs ?? null,
        ttsLatencyMs: data.ttsLatencyMs ?? null,
        turnTotalMs: data.turnTotalMs ?? null,
        providerSegmentId: data.providerSegmentId ?? null,
        spokenAt: new Date(),
      });
      await this.segmentRepo.save(seg);
    } catch (err) {
      // Idempotency: unique constraint on providerSegmentId — safe to ignore
      if (err instanceof QueryFailedError && String(err.message).includes('duplicate')) {
        this.logger.debug(`Duplicate segment skipped (providerSegmentId constraint)`);
      } else {
        throw err;
      }
    }
  }

  private defaultPolicy(): import('./entities/property-voice-policy.entity').PropertyVoicePolicyEntity {
    return {
      id: '',
      propertyId: '',
      voiceAssistantEnabled: true,
      autoAnswerEnabled: false,
      recordCallsEnabled: false,
      clarifyThreshold: 0.55,
      escalateThreshold: 0.35,
      maxTurns: 12,
      fallbackTransferNumber: null,
      afterHoursMode: 'short_ai',
      quietHoursStart: 22,
      quietHoursEnd: 8,
      emergencyEscalationEnabled: true,
      complaintAutoEscalate: true,
      preferredLanguages: 'ru',
      shortAnswerMode: true,
      allowedTopics: null,
      escalationTopics: null,
      customFallbackPhrases: null,
      transcriptRetentionDays: 90,
      redactionEnabled: false,
      exportAllowed: true,
      recordingStorageEnabled: false,
      recordingRetentionDays: 30,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private buildSkipResult(language: string, latencyMs: number): OrchestratorTurnResult {
    return {
      answer: getSafeResponse('hold', language),
      intent: 'other',
      confidence: 0,
      shouldEscalate: false,
      shouldTransferNow: false,
      escalationReason: null,
      kbSources: [],
      latencyMs,
      policyDecision: 'confident_answer',
      breakdown: { retrievalMs: 0, llmMs: 0 },
    };
  }
}
