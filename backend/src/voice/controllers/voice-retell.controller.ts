import {
  Controller, Post, Get, Headers, Body, Req,
  HttpCode, HttpStatus, Logger, UnauthorizedException,
  RawBodyRequest, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiExcludeEndpoint, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { verifyRetellSignature } from '../utils/retell-signature.util';
import { VoiceContextBuilderService } from '../services/voice-context-builder.service';
import { VoicePropertyResolverService } from '../services/voice-property-resolver.service';
import type { PropertyResolutionResult } from '../services/voice-property-resolver.service';
import { VoiceSessionService }        from '../voice-session.service';
import { VoiceOrchestratorService }   from '../voice-orchestrator.service';
import { VoiceHandoffService }        from '../voice-handoff.service';
import { VoiceRealtimeService }       from '../voice-realtime.service';
import { VoicePostCallService }       from '../voice-post-call.service';
import { VoiceRolloutService }        from '../voice-rollout.service';
import { VoiceProviderConfigService } from '../config/voice-provider.config';
import type {
  RetellInboundCallPayload,
  RetellEventWebhookPayload,
  RetellInboundCallResponse,
} from '../types/retell.types';
import type { VoiceProvider } from '../entities/call-session.entity';

// ── Per-process in-memory state ───────────────────────────────────────────────
// Lifecycle matches a single call — does not survive process restart.

/** Current property-resolution phase for a session */
type ResolutionState =
  | 'awaiting_property_name'
  | 'awaiting_disambiguation'
  | 'property_resolved';

interface SessionStateEntry {
  turnIndex:                  number;
  guestTurnsProcessed:        number;
  history:                    Array<{ role: 'user' | 'assistant'; content: string }>;
  resolutionState:            ResolutionState;
  resolutionAttempts:         number;
  /** propertyIds of disambiguation candidates */
  disambiguationCandidateIds: string[];
}

/**
 * Tracks conversation state per session.
 * key = sessionId
 */
const sessionState = new Map<string, SessionStateEntry>();

/**
 * Returns a default entry for new sessions (or after process restart).
 * Uses propertyId already set in DB to skip resolution if possible.
 */
function defaultEntry(propertyId: string | null): SessionStateEntry {
  return {
    turnIndex:                  0,
    guestTurnsProcessed:        0,
    history:                    [],
    resolutionState:            propertyId ? 'property_resolved' : 'awaiting_property_name',
    resolutionAttempts:         0,
    disambiguationCandidateIds: [],
  };
}

/**
 * Sessions where post-call processing has been triggered.
 * Prevents double-processing when both call_analyzed and call_ended arrive.
 */
const postCallTriggered = new Set<string>();

const PROVIDER: VoiceProvider = 'retell';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Structured log prefix for tracing across events */
function logCtx(callId: string, propertyId?: string | null, event?: string): string {
  return `[callId=${callId}${propertyId ? ` propertyId=${propertyId}` : ''}${event ? ` event=${event}` : ''}]`;
}

// ── Controller ────────────────────────────────────────────────────────────────

@ApiTags('Voice — Retell')
@Controller('voice/retell')
export class VoiceRetellController {
  private readonly logger = new Logger(VoiceRetellController.name);

  constructor(
    private readonly configSvc:    VoiceProviderConfigService,
    private readonly contextSvc:   VoiceContextBuilderService,
    private readonly resolverSvc:  VoicePropertyResolverService,
    private readonly sessionSvc:   VoiceSessionService,
    private readonly orchestrator: VoiceOrchestratorService,
    private readonly handoffSvc:   VoiceHandoffService,
    private readonly realtimeSvc:  VoiceRealtimeService,
    private readonly postCallSvc:  VoicePostCallService,
    private readonly rolloutSvc:   VoiceRolloutService,
  ) {}

  // ── POST /voice/retell/inbound ────────────────────────────────────────────
  /**
   * Retell calls this endpoint when an inbound call arrives on your phone number.
   * Must respond SYNCHRONOUSLY (≤ 5 s) with dynamic variables for the agent.
   * No heavy orchestration here — property resolution + policy load (cached) only.
   */
  @Post('inbound')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retell inbound call — return dynamic variables (synchronous)' })
  async handleInbound(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-retell-signature') sig: string | undefined,
    @Body() body: RetellInboundCallPayload,
  ): Promise<RetellInboundCallResponse> {
    this.verifySignature(req.rawBody, sig, 'inbound');

    const { call_id, from_number, to_number, agent_id } = body;
    this.logger.log(`${logCtx(call_id, null, 'inbound')} from=${from_number} to=${to_number}`);

    // ── Property resolution via DID map ───────────────────────────────────
    const propertyId = this.resolvePropertyByDid(to_number);

    // ── Rollout guard ─────────────────────────────────────────────────────
    if (propertyId) {
      const rollout = await this.rolloutSvc.getOrCreate(propertyId);
      if (!rollout.enabled || rollout.cohort === 'disabled') {
        this.logger.log(
          `${logCtx(call_id, propertyId, 'inbound')} property disabled (cohort=${rollout.cohort}) — returning safe fallback`,
        );
        return this.safeFallbackResponse(agent_id);
      }
    } else {
      this.logger.warn(`${logCtx(call_id, null, 'inbound')} no property resolved for to_number=${to_number}`);
    }

    // ── Context build (property + policy, cached) ─────────────────────────
    const context = await this.contextSvc.buildInboundContext({
      toNumber:      to_number,
      fromNumber:    from_number,
      propertyId:    propertyId,
      reservationId: null,
    });

    // ── Build response ────────────────────────────────────────────────────
    const cfg = this.configSvc.get();
    const response: RetellInboundCallResponse = {
      agent_id:          cfg.retellAgentId && cfg.retellAgentId !== agent_id
        ? cfg.retellAgentId
        : undefined,
      dynamic_variables: context.dynamicVariables,
      metadata: {
        property_id: propertyId ?? '',
        from_number,
        to_number,
      },
    };

    this.logger.log(
      `${logCtx(call_id, propertyId, 'inbound')} dynamic_variables returned (${Object.keys(context.dynamicVariables).length} keys)`,
    );
    return response;
  }

  // ── POST /voice/retell/webhook ────────────────────────────────────────────
  /**
   * Retell general event webhook.
   * Returns 200 immediately; heavy processing is async.
   * Idempotent: duplicate events are safely dropped.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-retell-signature') sig: string | undefined,
    @Body() body: RetellEventWebhookPayload,
  ): Promise<{ ok: boolean }> {
    this.verifySignature(req.rawBody, sig, 'webhook');

    const { event, call } = body;
    const callId = call?.call_id;

    if (!callId) {
      this.logger.warn('Retell webhook: missing call.call_id — ignored');
      return { ok: true };
    }

    this.logger.debug(`${logCtx(callId, null, event)} received`);

    void this.processEvent(event, call).catch((err: Error) =>
      this.logger.error(
        `${logCtx(callId, null, event)} processing error: ${err.message}`,
        err.stack,
      ),
    );

    return { ok: true };
  }

  // ── GET /voice/retell/status ──────────────────────────────────────────────
  /**
   * Lightweight provider status endpoint for manager UI.
   * Returns config state without exposing secrets.
   */
  @Get('status')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retell provider configuration status (no secrets)' })
  getStatus() {
    const cfg = this.configSvc.get();
    return {
      provider:                 'retell',
      inboundConfigured:        !!cfg.retellApiKey,
      eventWebhookConfigured:   !!cfg.retellWebhookSecret || !!cfg.retellApiKey,
      agentIdPresent:           !!cfg.retellAgentId,
      inboundNumberPresent:     !!cfg.retellInboundNumber,
      transferNumberPresent:    !!cfg.handoffTransferNumber,
      didMapPresent:            !!cfg.inboundDidPropertyMap,
      webhookSecretPresent:     !!cfg.retellWebhookSecret,
      featureFlagEnabled:       cfg.featureFlagEnabled,
      inboundWebhookPath:       'POST /api/v1/voice/retell/inbound',
      eventWebhookPath:         'POST /api/v1/voice/retell/webhook',
      inboundNumber:            cfg.retellInboundNumber ?? null,
      publicBackendUrl:         cfg.publicBackendUrl ?? null,
      didMapEntries:            cfg.inboundDidPropertyMap
        ? cfg.inboundDidPropertyMap.split(',').length
        : 0,
    };
  }

  // ── GET /voice/retell/test-payloads ───────────────────────────────────────
  /**
   * Returns example normalized payload shapes for each Retell event type.
   * Useful for QA/debugging without real calls.
   */
  @Get('test-payloads')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Example Retell webhook payload shapes (for QA/debug)' })
  getTestPayloads() {
    const exampleCallId = 'retell_call_example_00000000';
    const exampleFrom   = '+79991234567';
    const exampleTo     = '+79997654321';

    return {
      inbound: {
        call_id:     exampleCallId,
        agent_id:    'agent_example_id',
        call_type:   'inbound_phone_call',
        from_number: exampleFrom,
        to_number:   exampleTo,
        direction:   'inbound',
        call_status: 'registered',
      },
      call_started: {
        event: 'call_started',
        call: {
          call_id:     exampleCallId,
          from_number: exampleFrom,
          to_number:   exampleTo,
          call_status: 'ongoing',
        },
      },
      transcript: {
        event: 'transcript',
        call: {
          call_id: exampleCallId,
          transcript_object: [
            { role: 'agent', content: 'Здравствуйте, чем могу помочь?' },
            { role: 'user',  content: 'Как мне заселиться?' },
          ],
        },
      },
      call_transferred: {
        event:           'call_transferred',
        call: {
          call_id:              exampleCallId,
          transfer_destination: '+79990000000',
          transfer_status:      'completed',
        },
      },
      call_analyzed: {
        event: 'call_analyzed',
        call: {
          call_id:   exampleCallId,
          transcript: 'Агент: Здравствуйте. Гость: Как заселиться?',
          call_analysis: {
            call_summary:                    'Гость спрашивал про заселение',
            user_sentiment:                  'Positive',
            agent_task_completion_rating:    'Complete',
            agent_task_completion_rating_reason: 'Вопрос решён',
          },
        },
      },
      call_ended: {
        event: 'call_ended',
        call: {
          call_id:         exampleCallId,
          call_status:     'ended',
          start_timestamp: Date.now() - 120_000,
          end_timestamp:   Date.now(),
        },
      },
    };
  }

  // ── Event processing ──────────────────────────────────────────────────────

  private async processEvent(
    event: string,
    call: RetellEventWebhookPayload['call'],
  ): Promise<void> {
    const callId = call.call_id;

    switch (event) {
      // ── Call started ─────────────────────────────────────────────────────
      case 'call_started': {
        // Idempotent: skip if session already exists
        const existing = await this.sessionSvc.findByProviderCallId(callId);
        if (existing) {
          this.logger.debug(`${logCtx(callId, null, 'call_started')} duplicate — skipped`);
          return;
        }

        const session = await this.sessionSvc.create({
          provider:       PROVIDER,
          providerCallId: callId,
          toNumber:       call.to_number ?? null,
          guestPhone:     call.from_number ?? null,
        });

        await this.sessionSvc.markStarted(session.id);
        sessionState.set(session.id, defaultEntry(session.propertyId));

        this.realtimeSvc.emitCallCreated(session.id, {
          provider:      PROVIDER,
          status:        session.status,
          guestPhone:    session.guestPhone,
          propertyId:    session.propertyId,
          reservationId: session.reservationId,
        });

        this.logger.log(
          `${logCtx(callId, session.propertyId, 'call_started')} session=${session.id} created`,
        );
        break;
      }

      // ── Transcript update ─────────────────────────────────────────────────
      case 'transcript': {
        const turns      = call.transcript_object ?? [];
        const guestTurns = turns.filter((t) => t.role === 'user');

        if (guestTurns.length === 0) return;

        const session = await this.sessionSvc.findByProviderCallId(callId);
        if (!session) {
          this.logger.warn(`${logCtx(callId, null, 'transcript')} no session found — skipped`);
          return;
        }

        const state = sessionState.get(session.id) ?? defaultEntry(session.propertyId);

        // ── Dedup: only process NEW guest turns ───────────────────────────
        // Retell sends cumulative transcript_object — re-delivery has same N turns.
        if (guestTurns.length <= state.guestTurnsProcessed) {
          this.logger.debug(
            `${logCtx(callId, session.propertyId, 'transcript')} ` +
            `duplicate (${guestTurns.length} turns, already processed ${state.guestTurnsProcessed}) — skipped`,
          );
          return;
        }

        // Process each NEW guest turn since last event
        const newTurns = guestTurns.slice(state.guestTurnsProcessed);
        for (const turn of newTurns) {
          state.turnIndex           += 1;
          state.guestTurnsProcessed += 1;

          this.realtimeSvc.emitTranscriptSegment(session.id, {
            role:    'guest',
            content: turn.content,
            isFinal: true,
          });

          // ── Route: property resolution OR normal KB orchestration ─────
          if (state.resolutionState !== 'property_resolved') {
            // Property not yet identified — resolve from guest speech.
            // KB orchestration is deferred until property is known.
            await this.handlePropertyResolutionTurn(
              session.id, session.propertyId, callId, turn.content, state,
            );
          } else {
            this.realtimeSvc.emitAiStateChanged(session.id, 'processing');
            const capturedState = { turnIndex: state.turnIndex, history: [...state.history] };
            void this.runOrchestration(
              session.id, turn.content, capturedState, session.language ?? 'ru',
            ).then((updatedHistory) => {
              state.history = updatedHistory;
            }).catch((err: Error) =>
              this.logger.error(
                `${logCtx(callId, session.propertyId, 'orchestration')} ${err.message}`,
              ),
            );
          }
        }

        sessionState.set(session.id, state);
        break;
      }

      // ── Transfer ──────────────────────────────────────────────────────────
      case 'call_transferred': {
        const transferStatus = (call.transfer_status ?? 'unknown') as string;
        const destination    = call.transfer_destination ?? null;

        const session = await this.sessionSvc.findByProviderCallId(callId);
        if (!session) {
          this.logger.warn(`${logCtx(callId, null, 'call_transferred')} no session`);
          return;
        }

        // Always emit transfer.started first so frontend sees the initiation
        this.realtimeSvc.emitTransferStarted(session.id, { destination });

        if (transferStatus === 'completed') {
          await this.sessionSvc.updateHandoffStatus(session.id, 'completed');
          this.realtimeSvc.emitTransferEnded(session.id, {
            status:      'completed',
            destination,
          });
          this.logger.log(
            `${logCtx(callId, session.propertyId, 'call_transferred')} ` +
            `completed → destination=${destination ?? 'unknown'}`,
          );
        } else {
          this.realtimeSvc.emitTransferEnded(session.id, {
            status:      transferStatus as 'failed' | 'cancelled',
            destination,
          });
          this.logger.warn(
            `${logCtx(callId, session.propertyId, 'call_transferred')} status=${transferStatus}`,
          );
        }
        break;
      }

      // ── Post-call analysis ────────────────────────────────────────────────
      case 'call_analyzed': {
        const session = await this.sessionSvc.findByProviderCallId(callId);
        if (!session) {
          this.logger.warn(`${logCtx(callId, null, 'call_analyzed')} no session`);
          return;
        }

        const analysis  = call.call_analysis;
        const summary   = analysis?.call_summary ?? call.transcript ?? null;
        const sentiment = analysis?.user_sentiment ?? 'Unknown';

        await this.sessionSvc.markEnded(session.id, 'call_analyzed', summary ?? undefined);

        // ── Post-call guard: trigger once per session ─────────────────────
        if (!postCallTriggered.has(session.id)) {
          postCallTriggered.add(session.id);
          void this.postCallSvc.processSession(session.id).catch((err: Error) =>
            this.logger.error(
              `${logCtx(callId, session.propertyId, 'post_call')} ${err.message}`,
            ),
          );
        }

        sessionState.delete(session.id);
        this.realtimeSvc.emitCallEnded(session.id, {
          endedBy: 'call_analyzed',
          sentiment,
        });

        this.logger.log(
          `${logCtx(callId, session.propertyId, 'call_analyzed')} ` +
          `sentiment=${sentiment} task=${analysis?.agent_task_completion_rating ?? 'n/a'}`,
        );
        break;
      }

      // ── Call ended ────────────────────────────────────────────────────────
      case 'call_ended': {
        const session = await this.sessionSvc.findByProviderCallId(callId);
        if (!session) {
          this.logger.warn(`${logCtx(callId, null, 'call_ended')} no session`);
          return;
        }

        // markEnded already guards against double-terminal via CallStatusMachine.isTerminal()
        const durationMs = call.end_timestamp && call.start_timestamp
          ? call.end_timestamp - call.start_timestamp
          : undefined;

        await this.sessionSvc.markEnded(session.id, 'provider_event');
        sessionState.delete(session.id);

        // ── Post-call guard: trigger once per session ─────────────────────
        if (!postCallTriggered.has(session.id)) {
          postCallTriggered.add(session.id);
          void this.postCallSvc.processSession(session.id).catch(() => {
            // Silenced — post-call failure must not affect webhook response
          });
        }

        // Auto-evict from post-call tracking after some time to prevent memory growth
        setTimeout(() => postCallTriggered.delete(session.id), 60_000);

        this.realtimeSvc.emitCallEnded(session.id, {
          endedBy: 'provider_event',
          durationMs,
        });

        this.logger.log(
          `${logCtx(callId, session.propertyId, 'call_ended')} ` +
          `duration=${durationMs ?? '?'}ms`,
        );
        break;
      }

      default:
        this.logger.debug(`${logCtx(callId, null, event)} unhandled event type — ignored`);
    }
  }

  // ── Orchestration ─────────────────────────────────────────────────────────

  /**
   * Runs AI turn and returns the updated history array.
   * Uses a snapshot of state to avoid race conditions with concurrent turns.
   */
  private async runOrchestration(
    sessionId: string,
    guestQuery: string,
    snapshot: { turnIndex: number; history: Array<{ role: 'user' | 'assistant'; content: string }> },
    language: string,
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const session = await this.sessionSvc.findById(sessionId);
    if (!session) return snapshot.history;

    const result = await this.orchestrator.processTurn({
      sessionId,
      propertyId:          session.propertyId,
      reservationId:       session.reservationId,
      guestQuery,
      language,
      turnIndex:           snapshot.turnIndex,
      conversationHistory: snapshot.history,
    });

    const updatedHistory = [
      ...snapshot.history,
      { role: 'user' as const,      content: guestQuery },
      { role: 'assistant' as const, content: result.answer },
    ];
    // Cap at 20 messages (10 turns)
    const trimmed = updatedHistory.length > 20
      ? updatedHistory.slice(updatedHistory.length - 20)
      : updatedHistory;

    this.realtimeSvc.emitTranscriptSegment(sessionId, {
      role:       'ai',
      content:    result.answer,
      intent:     result.intent,
      confidence: result.confidence,
      kbSources:  result.kbSources,
      latencyMs:  result.latencyMs,
    });
    this.realtimeSvc.emitAiStateChanged(sessionId, 'ai_speaking');

    if (result.shouldEscalate) {
      this.realtimeSvc.emitEscalationRequested(
        sessionId,
        result.escalationReason ?? 'ai_decision',
        result.shouldTransferNow ? 'transfer_now' : 'notify_operator',
      );
    }

    if (result.shouldTransferNow && session.providerCallId) {
      await this.handoffSvc.requestHandoff({
        sessionId,
        providerCallId:   session.providerCallId,
        mode:             'hard_transfer',
        reason:           result.answer,
        escalationReason: result.escalationReason ?? 'ai_decision',
      });
    } else if (result.shouldEscalate) {
      await this.handoffSvc.requestHandoff({
        sessionId,
        providerCallId:   session.providerCallId,
        mode:             'supervised',
        reason:           result.answer,
        escalationReason: result.escalationReason ?? 'ai_decision',
      });
    }

    if (result.intent !== 'other') {
      this.realtimeSvc.emitIntentDetected(
        sessionId, result.intent, result.confidence, result.kbSources,
      );
    }

    return trimmed;
  }

  // ── Property resolution ───────────────────────────────────────────────────

  /**
   * Handles a guest turn when the property has not yet been resolved.
   *
   * State machine:
   *   awaiting_property_name  → resolveByVoiceInput
   *   awaiting_disambiguation → resolveByAddressHint (with prior candidates)
   *
   * On resolution: updates DB + emits socket notification.
   * On ambiguity:  asks for street/address clarification.
   * On failure (≥ 2 attempts): escalates to operator.
   */
  private async handlePropertyResolutionTurn(
    sessionId: string,
    currentPropertyId: string | null,
    callId: string,
    guestText: string,
    state: SessionStateEntry,
  ): Promise<void> {
    let result: PropertyResolutionResult;

    if (state.resolutionState === 'awaiting_disambiguation') {
      result = await this.resolverSvc.resolveByAddressHint(
        guestText,
        state.disambiguationCandidateIds,
      );
    } else {
      result = await this.resolverSvc.resolveByVoiceInput(guestText);
    }

    if (result.status === 'resolved' && result.property) {
      await this.sessionSvc.setPropertyId(sessionId, result.property.propertyId);
      state.resolutionState            = 'property_resolved';
      state.disambiguationCandidateIds = [];

      const confirmText =
        `Подтверждаю: объект «${result.property.name}». Чем могу помочь?`;
      this.realtimeSvc.emitTranscriptSegment(sessionId, {
        role: 'ai', content: confirmText, isFinal: true,
      });
      this.realtimeSvc.emitCallUpdated(sessionId, {
        propertyId:      result.property.propertyId,
        propertyName:    result.property.name,
        resolutionState: 'property_resolved',
        resolutionSource:'voice_name_match',
      });
      this.logger.log(
        `${logCtx(callId, result.property.propertyId, 'property_resolution')} ` +
        `resolved: "${result.property.name}"`,
      );
      return;
    }

    if (result.status === 'ambiguous') {
      state.resolutionState            = 'awaiting_disambiguation';
      state.disambiguationCandidateIds = result.candidates.slice(0, 5).map(c => c.propertyId);
      state.resolutionAttempts        += 1;

      const nameList = result.candidates
        .slice(0, 3)
        .map(c => `«${c.name}»`)
        .join(', ');
      const disambText =
        `Нашёл несколько похожих объектов: ${nameList}. ` +
        `Уточните, пожалуйста, на какой улице находится нужный объект?`;
      this.realtimeSvc.emitTranscriptSegment(sessionId, {
        role: 'ai', content: disambText, isFinal: true,
      });
      this.realtimeSvc.emitCallUpdated(sessionId, {
        resolutionState: 'awaiting_disambiguation',
        candidateCount:  result.candidates.length,
      });
      this.logger.log(
        `${logCtx(callId, currentPropertyId, 'property_resolution')} ` +
        `ambiguous: ${result.candidates.length} candidates`,
      );
      return;
    }

    // not_found
    state.resolutionAttempts += 1;

    if (state.resolutionAttempts >= 2) {
      const fallbackText =
        'К сожалению, не удалось определить объект. Позвольте перевести вас на менеджера.';
      this.realtimeSvc.emitTranscriptSegment(sessionId, {
        role: 'ai', content: fallbackText, isFinal: true,
      });
      this.realtimeSvc.emitCallUpdated(sessionId, { resolutionState: 'resolution_failed' });
      this.realtimeSvc.emitEscalationRequested(
        sessionId, 'property_not_resolved', 'notify_operator',
      );
      this.logger.warn(
        `${logCtx(callId, currentPropertyId, 'property_resolution')} ` +
        `failed after ${state.resolutionAttempts} attempts — escalating`,
      );
    } else {
      const retryText =
        'Не удалось найти такой объект. Пожалуйста, назовите точное название объекта.';
      this.realtimeSvc.emitTranscriptSegment(sessionId, {
        role: 'ai', content: retryText, isFinal: true,
      });
      this.realtimeSvc.emitCallUpdated(sessionId, {
        resolutionState: 'awaiting_property_name',
        attempt:         state.resolutionAttempts,
      });
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private verifySignature(
    rawBody: Buffer | undefined,
    sig: string | undefined,
    endpoint: string,
  ): void {
    const isProduction = process.env['NODE_ENV'] === 'production';
    const cfg = this.configSvc.get();

    // In development without a secret, skip silently
    if (!rawBody || !sig) {
      if (isProduction) {
        this.logger.warn(`Retell ${endpoint}: missing raw body or signature header`);
        throw new UnauthorizedException('Missing webhook signature');
      }
      return;
    }

    const secret = cfg.retellWebhookSecret ?? cfg.retellApiKey ?? '';
    if (!secret) {
      if (isProduction) {
        this.logger.error(`Retell ${endpoint}: no signing secret configured`);
        throw new UnauthorizedException('Webhook secret not configured');
      }
      this.logger.warn(`Retell ${endpoint}: no RETELL_WEBHOOK_SECRET — skipping signature check (dev mode)`);
      return;
    }

    if (!verifyRetellSignature(rawBody, sig, secret)) {
      this.logger.warn(`Retell ${endpoint}: HMAC verification failed`);
      throw new UnauthorizedException('Invalid Retell webhook signature');
    }
  }

  private resolvePropertyByDid(toNumber: string | null | undefined): string | null {
    if (!toNumber) return null;
    const mapEnv = process.env['INBOUND_DID_PROPERTY_MAP'] ?? '';
    if (mapEnv) {
      for (const pair of mapEnv.split(',')) {
        const [did, pid] = pair.split(':');
        if (did?.trim() === toNumber.trim()) return pid?.trim() ?? null;
      }
    }
    return null;
  }

  private safeFallbackResponse(agentId: string): RetellInboundCallResponse {
    return {
      agent_id: agentId,
      dynamic_variables: {
        property_enabled: 'false',
        language_hint:    'ru',
        handoff_number:   process.env['HANDOFF_TRANSFER_NUMBER'] ?? '',
      },
    };
  }
}
