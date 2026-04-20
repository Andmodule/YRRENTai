import {
  Controller,
  Post,
  Headers,
  Body,
  RawBodyRequest,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request } from 'express';
import { VoiceProviderAdapter } from './adapters/voice-provider.adapter';
import { VoiceSessionService } from './voice-session.service';
import { VoiceOrchestratorService } from './voice-orchestrator.service';
import { VoiceHandoffService } from './voice-handoff.service';
import { VoiceRealtimeService } from './voice-realtime.service';
import type { VoiceProvider } from './entities/call-session.entity';

/** In-flight sessions: sessionId → turn index + conversation history */
const sessionState = new Map<
  string,
  { turnIndex: number; history: Array<{ role: 'user' | 'assistant'; content: string }> }
>();

@ApiTags('Voice Inbound')
@Controller('voice/inbound')
export class VoiceWebhookController {
  private readonly logger = new Logger(VoiceWebhookController.name);

  constructor(
    private readonly adapter: VoiceProviderAdapter,
    private readonly sessionService: VoiceSessionService,
    private readonly orchestrator: VoiceOrchestratorService,
    private readonly handoffService: VoiceHandoffService,
    private readonly realtimeService: VoiceRealtimeService,
  ) {}

  /**
   * Retell / Vapi webhook endpoint.
   * - Validates webhook signature
   * - Idempotent: duplicate events for the same call are safe to receive
   * - Heavy orchestration runs asynchronously; this returns 200 immediately
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive voice provider webhook events' })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-retell-signature') retellSig: string,
    @Headers('x-vapi-signature') vapiSig: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ ok: boolean }> {
    const rawBody = req.rawBody;
    const signature = retellSig ?? vapiSig ?? '';

    if (rawBody && signature) {
      const valid = this.adapter.validateWebhook(rawBody, signature);
      if (!valid) {
        this.logger.warn('Webhook signature validation failed');
        throw new BadRequestException('Invalid webhook signature');
      }
    }

    const event = this.adapter.handleEvent(body);
    if (!event) {
      return { ok: true };
    }

    const providerName = this.adapter.providerName as VoiceProvider;

    try {
      switch (event.type) {
        case 'call_started': {
          const existing = event.providerCallId
            ? await this.sessionService.findByProviderCallId(event.providerCallId)
            : null;

          if (existing) {
            this.logger.debug(`Duplicate call_started for ${event.providerCallId} — skipped`);
            break;
          }

          const session = await this.sessionService.create({
            provider: providerName,
            providerCallId: event.providerCallId,
            toNumber: event.toNumber ?? null,
            guestPhone: event.fromNumber ?? null,
          });

          await this.sessionService.markStarted(session.id);
          sessionState.set(session.id, { turnIndex: 0, history: [] });

          this.realtimeService.emitCallCreated(session.id, {
            provider: providerName,
            status: session.status,
            guestPhone: session.guestPhone,
            propertyId: session.propertyId,
            reservationId: session.reservationId,
          });

          this.logger.log(`Call started: session ${session.id}, call ${event.providerCallId}`);
          break;
        }

        case 'transcript': {
          const { transcript } = event;
          if (!transcript?.isFinal || transcript.role !== 'guest') break;

          const session = await this.sessionService.findByProviderCallId(event.providerCallId);
          if (!session) {
            this.logger.warn(`No session for providerCallId ${event.providerCallId}`);
            break;
          }

          const state = sessionState.get(session.id) ?? { turnIndex: 0, history: [] };
          state.turnIndex += 1;

          this.realtimeService.emitAiStateChanged(session.id, 'processing');

          // Run orchestration asynchronously so webhook returns fast
          void this.runOrchestration(session.id, transcript.content, state, session.language ?? 'ru').catch(
            (err: Error) => this.logger.error(`Orchestration error: ${err.message}`),
          );

          sessionState.set(session.id, state);

          this.realtimeService.emitTranscriptSegment(session.id, {
            role: 'guest',
            content: transcript.content,
            isFinal: true,
          });
          break;
        }

        case 'call_ended': {
          const session = await this.sessionService.findByProviderCallId(event.providerCallId);
          if (!session) break;

          await this.sessionService.markEnded(session.id, 'provider_event');
          sessionState.delete(session.id);

          this.realtimeService.emitCallEnded(session.id, {
            endedBy: 'provider_event',
          });
          break;
        }
      }
    } catch (err) {
      this.logger.error(`Webhook handler error: ${(err as Error).message}`, (err as Error).stack);
    }

    return { ok: true };
  }

  private async runOrchestration(
    sessionId: string,
    guestQuery: string,
    state: { turnIndex: number; history: Array<{ role: 'user' | 'assistant'; content: string }> },
    language: string,
  ): Promise<void> {
    const session = await this.sessionService.findById(sessionId);
    if (!session) return;

    const result = await this.orchestrator.processTurn({
      sessionId,
      propertyId: session.propertyId,
      reservationId: session.reservationId,
      guestQuery,
      language,
      turnIndex: state.turnIndex,
      conversationHistory: [...state.history],
    });

    // Update conversation history for context continuity
    state.history.push({ role: 'user', content: guestQuery });
    state.history.push({ role: 'assistant', content: result.answer });
    // Keep last 10 turns in memory to limit token count
    if (state.history.length > 20) {
      state.history.splice(0, state.history.length - 20);
    }

    this.realtimeService.emitTranscriptSegment(sessionId, {
      role: 'ai',
      content: result.answer,
      intent: result.intent,
      confidence: result.confidence,
      kbSources: result.kbSources,
      latencyMs: result.latencyMs,
    });

    this.realtimeService.emitAiStateChanged(sessionId, 'ai_speaking');

    if (result.shouldEscalate) {
      this.realtimeService.emitEscalationRequested(
        sessionId,
        result.escalationReason ?? 'unknown',
        result.shouldTransferNow ? 'transfer_now' : 'notify_operator',
      );
    }

    if (result.shouldTransferNow && session.providerCallId) {
      await this.handoffService.requestHandoff({
        sessionId,
        providerCallId: session.providerCallId,
        mode: 'hard_transfer',
        reason: result.answer,
        escalationReason: result.escalationReason ?? 'ai_decision',
      });
    } else if (result.shouldEscalate) {
      await this.handoffService.requestHandoff({
        sessionId,
        providerCallId: session.providerCallId,
        mode: 'supervised',
        reason: result.answer,
        escalationReason: result.escalationReason ?? 'ai_decision',
      });
    }

    if (result.intent !== 'other') {
      this.realtimeService.emitIntentDetected(
        sessionId,
        result.intent,
        result.confidence,
        result.kbSources,
      );
    }
  }
}
