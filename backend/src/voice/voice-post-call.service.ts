import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { CallReviewEntity, QaFlag } from './entities/call-review.entity';
import { CallSessionEntity } from './entities/call-session.entity';
import { CallTranscriptSegmentEntity } from './entities/call-transcript-segment.entity';
import { CallEventEntity } from './entities/call-event.entity';
import { VoiceMetricsService } from './voice-metrics.service';

interface SessionEndedEvent {
  sessionId: string;
}

const SUMMARY_PROMPT = `
Ты — аналитик звонков системы аренды. Проанализируй транскрипт звонка и верни ТОЛЬКО JSON:
{
  "summary": "<1-3 предложения о сути звонка>",
  "detectedIntents": ["<intent1>", "<intent2>"],
  "unresolvedQuestions": ["<вопрос, на который не дан ответ>"],
  "escalationReason": "<причина или null>",
  "followUpRequired": <true|false>,
  "followUpSuggestion": "<что нужно сделать оператору или null>",
  "kbImprovementHints": [{"question": "...", "suggestedUpdate": "..."}]
}

ТРАНСКРИПТ:
{{TRANSCRIPT}}
`.trim();

@Injectable()
export class VoicePostCallService {
  private readonly logger = new Logger(VoicePostCallService.name);
  private readonly llm: OpenAI;

  constructor(
    @InjectRepository(CallReviewEntity)
    private readonly reviewRepo: Repository<CallReviewEntity>,
    @InjectRepository(CallSessionEntity)
    private readonly sessionRepo: Repository<CallSessionEntity>,
    @InjectRepository(CallTranscriptSegmentEntity)
    private readonly segmentRepo: Repository<CallTranscriptSegmentEntity>,
    @InjectRepository(CallEventEntity)
    private readonly eventRepo: Repository<CallEventEntity>,
    private readonly metrics: VoiceMetricsService,
    private readonly config: ConfigService,
  ) {
    const provider = config.get<string>('AI_PROVIDER', 'deepseek');
    const apiKey =
      provider === 'openai'
        ? (config.get<string>('OPENAI_API_KEY') ?? '')
        : (config.get<string>('DEEPSEEK_API_KEY') ?? '');
    const baseURL =
      provider === 'openai'
        ? 'https://api.openai.com/v1'
        : config.get<string>('DEEPSEEK_BASE_URL', 'https://api.deepseek.com');
    this.llm = new OpenAI({ apiKey, baseURL });
  }

  /** Called by VoiceSessionService after markEnded() via EventEmitter */
  @OnEvent('voice.session.ended')
  async handleSessionEnded(event: SessionEndedEvent): Promise<void> {
    this.logger.log(`Post-call processing: ${event.sessionId}`);
    try {
      await this.processSession(event.sessionId);
    } catch (err) {
      this.logger.error(`Post-call processing failed: ${(err as Error).message}`, event.sessionId);
    }
  }

  /** Can also be called manually for replay / re-processing */
  async processSession(sessionId: string): Promise<CallReviewEntity> {
    // Idempotent: return existing review if already processed
    const existing = await this.reviewRepo.findOne({ where: { sessionId } });
    if (existing && existing.status !== 'pending') return existing;

    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const segments = await this.segmentRepo.find({
      where: { sessionId },
      order: { turnIndex: 'ASC' },
    });

    const events = await this.eventRepo.find({ where: { sessionId }, order: { createdAt: 'ASC' } });

    // ── Aggregate metrics ────────────────────────────────────────────────────
    const aiSegments = segments.filter((s) => s.role === 'ai');
    const avgConfidence =
      aiSegments.length > 0
        ? aiSegments.reduce((acc, s) => acc + (s.confidence ?? 0), 0) / aiSegments.length
        : null;

    const fallbackCount = events.filter((e) => e.type === 'fallback_triggered').length;
    const durationSeconds = session.startedAt && session.endedAt
      ? Math.round((session.endedAt.getTime() - session.startedAt.getTime()) / 1000)
      : null;

    // ── QA flags ─────────────────────────────────────────────────────────────
    const qaFlags = this.buildQaFlags(session, segments, events, avgConfidence);

    // ── Transfer outcome ─────────────────────────────────────────────────────
    const transferOutcome = this.resolveTransferOutcome(events);

    // ── LLM summary ─────────────────────────────────────────────────────────
    const llmResult = await this.generateSummary(segments);

    // ── Record metrics ────────────────────────────────────────────────────────
    if (fallbackCount > 0) {
      this.metrics.fallbackTotal.inc({ reason: 'post_call_count' }, fallbackCount);
    }

    // ── Upsert review ────────────────────────────────────────────────────────
    const review = existing ?? this.reviewRepo.create({ sessionId });

    review.summary = llmResult.summary ?? null;
    review.detectedIntents = llmResult.detectedIntents ?? null;
    review.unresolvedQuestions = llmResult.unresolvedQuestions ?? null;
    review.escalationReason = session.handoffStatus !== 'none'
      ? (llmResult.escalationReason ?? 'escalated')
      : null;
    review.transferOutcome = transferOutcome;
    review.qaFlags = qaFlags;
    review.followUpRequired = llmResult.followUpRequired ?? false;
    review.followUpSuggestion = llmResult.followUpSuggestion ?? null;
    review.kbImprovementHints = llmResult.kbImprovementHints ?? null;
    review.totalTurns = session.turnCount;
    review.avgTurnLatencyMs = session.avgTurnLatencyMs;
    review.avgConfidence = avgConfidence;
    review.fallbackCount = fallbackCount;
    review.durationSeconds = durationSeconds;

    return this.reviewRepo.save(review);
  }

  async getReview(sessionId: string): Promise<CallReviewEntity | null> {
    return this.reviewRepo.findOne({ where: { sessionId } });
  }

  async updateReview(
    sessionId: string,
    dto: {
      reviewerNote?: string;
      qualityRating?: number;
      status?: CallReviewEntity['status'];
    },
    reviewerUserId: string,
  ): Promise<CallReviewEntity> {
    const review = await this.reviewRepo.findOneOrFail({ where: { sessionId } });
    if (dto.reviewerNote !== undefined) review.reviewerNote = dto.reviewerNote;
    if (dto.qualityRating !== undefined) review.qualityRating = dto.qualityRating;
    if (dto.status !== undefined) review.status = dto.status;
    review.reviewedByUserId = reviewerUserId;
    review.reviewedAt = new Date();
    return this.reviewRepo.save(review);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private buildQaFlags(
    session: CallSessionEntity,
    segments: CallTranscriptSegmentEntity[],
    events: CallEventEntity[],
    avgConfidence: number | null,
  ): QaFlag[] {
    const flags: QaFlag[] = [];

    if (avgConfidence !== null && avgConfidence < 0.45) flags.push('low_confidence');
    if (events.some((e) => e.type === 'fallback_triggered')) flags.push('fallback_triggered');
    if (events.some((e) => e.type === 'emergency_guard')) flags.push('emergency_detected');
    if (session.handoffStatus !== 'none') {
      const escalation = events.find((e) => e.type === 'escalation_requested');
      if ((escalation?.payload?.['reason'] as string | undefined) === 'complaint') {
        flags.push('complaint_detected');
      }
    }
    if (segments.some((s) => s.triggeredEscalation && s.kbSources?.length === 0)) {
      flags.push('kb_miss');
    }
    if ((session.turnCount ?? 0) > 10) flags.push('long_session');
    if (
      (session.avgTurnLatencyMs ?? 0) > 1500
    ) {
      flags.push('high_latency');
    }

    const hasUnresolved = segments.some(
      (s) => s.role === 'ai' && s.triggeredEscalation && s.intent !== 'transfer_request',
    );
    if (hasUnresolved) flags.push('unresolved_question');

    return flags;
  }

  private resolveTransferOutcome(events: CallEventEntity[]): string {
    const handoffCompleted = events.some((e) => e.type === 'handoff_completed');
    const handoffStarted = events.some((e) => e.type === 'handoff_started');
    const recovered = events.some(
      (e) => e.type === 'provider_webhook' && (e.payload?.['reason'] as string | undefined) === 'transfer_recovered',
    );

    if (recovered) return 'recovered';
    if (handoffCompleted) return 'completed';
    if (handoffStarted) return 'failed';
    return 'none';
  }

  private async generateSummary(segments: CallTranscriptSegmentEntity[]): Promise<{
    summary?: string;
    detectedIntents?: string[];
    unresolvedQuestions?: string[];
    escalationReason?: string | null;
    followUpRequired?: boolean;
    followUpSuggestion?: string | null;
    kbImprovementHints?: Array<{ question: string; suggestedUpdate: string }>;
  }> {
    if (segments.length === 0) {
      return { summary: 'Транскрипт пуст', detectedIntents: [], unresolvedQuestions: [] };
    }

    const transcriptText = segments
      .map((s) => `[${s.role.toUpperCase()}]: ${s.content}`)
      .join('\n');

    const provider = this.config.get<string>('AI_PROVIDER', 'deepseek');
    const modelDefault = provider === 'openai' ? 'gpt-4o-mini' : 'deepseek-chat';
    const model = this.config.get<string>('VOICE_PARSE_LLM_MODEL', modelDefault);

    try {
      const response = await this.llm.chat.completions.create({
        model,
        messages: [
          {
            role: 'user',
            content: SUMMARY_PROMPT.replace('{{TRANSCRIPT}}', transcriptText.slice(0, 8000)),
          },
        ],
        temperature: 0.2,
        max_tokens: 1024,
      });

      const raw = response.choices[0]?.message?.content ?? '';
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      return JSON.parse(cleaned) as ReturnType<VoicePostCallService['generateSummary']> extends Promise<infer T>
        ? T
        : never;
    } catch (err) {
      this.logger.warn(`Summary LLM failed: ${(err as Error).message}`);
      return {
        summary: 'Не удалось сформировать автоматическое резюме.',
        detectedIntents: [...new Set(segments.filter((s) => s.intent).map((s) => s.intent!))],
        unresolvedQuestions: [],
      };
    }
  }
}
