import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CallHandoffEntity, HandoffMode } from './entities/call-handoff.entity';
import { CallSessionEntity } from './entities/call-session.entity';
import { CallTranscriptSegmentEntity } from './entities/call-transcript-segment.entity';
import { BookingEntity } from '../booking/entities/booking.entity';
import { PropertyEntity } from '../property/entities/property.entity';
import { VoiceSessionService } from './voice-session.service';
import { VoiceRealtimeService } from './voice-realtime.service';
import { VoiceProviderAdapter } from './adapters/voice-provider.adapter';
import { VoiceMetricsService } from './voice-metrics.service';
import { getSafeResponse } from './voice-safe-responses';
import { getCapabilities } from './adapters/provider-capabilities';

export interface RequestHandoffInput {
  sessionId: string;
  providerCallId: string | null;
  mode: HandoffMode;
  reason: string;
  escalationReason: string;
  /** Hold phrase played to the guest while transfer is in progress */
  holdPhrase?: string;
}

/** Operator briefing payload sent via Socket.IO before bridge */
export interface WarmTransferBriefing {
  sessionId: string;
  guestPhone: string | null;
  propertyName: string | null;
  propertyAddress: string | null;
  guestName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  lastIntent: string | null;
  escalationReason: string;
  lastAiResponse: string | null;
  turnCount: number;
  avgLatencyMs: number | null;
  transcriptSnippet: string;
}

const TRANSFER_TIMEOUT_MS = 45_000; // 45 s before recovery fires

@Injectable()
export class VoiceHandoffService {
  private readonly logger = new Logger(VoiceHandoffService.name);

  /** Pending transfers: providerCallId → { handoffId, timeout handle } */
  private readonly pendingTransfers = new Map<
    string,
    { handoffId: string; sessionId: string; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    @InjectRepository(CallHandoffEntity)
    private readonly handoffRepo: Repository<CallHandoffEntity>,
    @InjectRepository(CallSessionEntity)
    private readonly sessionRepo: Repository<CallSessionEntity>,
    @InjectRepository(CallTranscriptSegmentEntity)
    private readonly segmentRepo: Repository<CallTranscriptSegmentEntity>,
    @InjectRepository(BookingEntity)
    private readonly bookingRepo: Repository<BookingEntity>,
    @InjectRepository(PropertyEntity)
    private readonly propertyRepo: Repository<PropertyEntity>,
    private readonly sessionService: VoiceSessionService,
    private readonly realtimeService: VoiceRealtimeService,
    private readonly voiceProvider: VoiceProviderAdapter,
    private readonly metricsService: VoiceMetricsService,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────

  async requestHandoff(input: RequestHandoffInput): Promise<CallHandoffEntity> {
    const handoff = this.handoffRepo.create({
      sessionId: input.sessionId,
      mode: input.mode,
      status: 'requested',
      reason: input.reason,
      escalationReason: input.escalationReason,
      requestedAt: new Date(),
    });
    await this.handoffRepo.save(handoff);

    await this.sessionService.updateHandoffStatus(input.sessionId, 'requested');
    await this.sessionService.appendEvent(input.sessionId, 'handoff_started', {
      handoffId: handoff.id,
      mode: input.mode,
      escalationReason: input.escalationReason,
    });

    this.metricsService.handoffTotal.inc({
      mode: input.mode,
      escalation_reason: input.escalationReason,
    });

    // Build briefing for operator before transfer
    const briefing = await this.buildBriefing(input.sessionId, input.escalationReason);
    this.realtimeService.emitHandoffStarted(input.sessionId, {
      handoffId: handoff.id,
      mode: input.mode,
      reason: input.reason,
      escalationReason: input.escalationReason,
      briefing,
    });

    const session = await this.sessionService.findById(input.sessionId);
    const caps = getCapabilities(this.voiceProvider.providerName);

    if (input.mode === 'hard_transfer' && input.providerCallId) {
      const transferNumber =
        process.env['HANDOFF_TRANSFER_NUMBER'];

      if (transferNumber) {
        // Start failed-transfer recovery timer
        const timer = setTimeout(
          () => void this.onTransferTimeout(input.providerCallId!, input.sessionId, handoff.id),
          TRANSFER_TIMEOUT_MS,
        );
        this.pendingTransfers.set(input.providerCallId, {
          handoffId: handoff.id,
          sessionId: input.sessionId,
          timer,
        });

        try {
          if (caps.supportsColdTransfer) {
            await this.voiceProvider.transferCall({
              providerCallId: input.providerCallId,
              destinationNumber: transferNumber,
            });
          } else {
            this.logger.warn(
              `Provider ${this.voiceProvider.providerName} does not support cold transfer`,
            );
          }
        } catch (err) {
          this.logger.error(`Transfer failed: ${(err as Error).message}`);
          clearTimeout(timer);
          this.pendingTransfers.delete(input.providerCallId);
          await this.onTransferFailed(input.sessionId, handoff.id, (err as Error).message);
        }
      } else {
        this.logger.warn('HANDOFF_TRANSFER_NUMBER not set — skipping transfer');
      }
    }

    return handoff;
  }

  async acceptHandoff(handoffId: string, operatorUserId: string): Promise<void> {
    const handoff = await this.handoffRepo.findOne({ where: { id: handoffId } });
    if (!handoff) throw new NotFoundException(`Handoff ${handoffId} not found`);

    // Clear transfer timeout if still pending
    const pending = [...this.pendingTransfers.entries()].find(
      ([, v]) => v.handoffId === handoffId,
    );
    if (pending) {
      clearTimeout(pending[1].timer);
      this.pendingTransfers.delete(pending[0]);
    }

    await this.handoffRepo.update(handoffId, {
      status: 'accepted',
      acceptedByUserId: operatorUserId,
      acceptedAt: new Date(),
    });

    await this.sessionService.setTakenOverBy(handoff.sessionId, operatorUserId);
    await this.sessionService.appendEvent(handoff.sessionId, 'handoff_completed', {
      handoffId,
      operatorUserId,
    });

    this.realtimeService.emitHandoffCompleted(handoff.sessionId, { handoffId, operatorUserId });
  }

  async operatorTakeover(sessionId: string, operatorUserId: string): Promise<void> {
    let handoff = await this.handoffRepo.findOne({
      where: { sessionId, status: 'requested' },
    });

    if (!handoff) {
      handoff = this.handoffRepo.create({
        sessionId,
        mode: 'supervised',
        status: 'accepted',
        reason: 'operator_initiated',
        escalationReason: 'operator_takeover',
        requestedAt: new Date(),
        acceptedAt: new Date(),
        acceptedByUserId: operatorUserId,
      });
      await this.handoffRepo.save(handoff);
    } else {
      await this.handoffRepo.update(handoff.id, {
        status: 'accepted',
        acceptedByUserId: operatorUserId,
        acceptedAt: new Date(),
      });
    }

    await this.sessionService.setTakenOverBy(sessionId, operatorUserId);
    this.realtimeService.emitHandoffCompleted(sessionId, {
      handoffId: handoff.id,
      operatorUserId,
    });
    this.logger.log(`Operator ${operatorUserId} took over session ${sessionId}`);
  }

  /**
   * Called when provider reports a successful transfer completion.
   * Clears the recovery timer.
   */
  async onTransferCompleted(providerCallId: string): Promise<void> {
    const pending = this.pendingTransfers.get(providerCallId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingTransfers.delete(providerCallId);

    await this.handoffRepo.update(pending.handoffId, {
      status: 'completed',
      completedAt: new Date(),
    });
    await this.sessionService.appendEvent(pending.sessionId, 'handoff_completed', {
      transferOutcome: 'completed',
    });
    this.logger.log(`Transfer completed for session ${pending.sessionId}`);
  }

  // ── Private: recovery flow ─────────────────────────────────────────────

  /**
   * Fires when a transfer hasn't completed within TRANSFER_TIMEOUT_MS.
   * AI returns to the call with a recovery phrase.
   */
  private async onTransferTimeout(
    providerCallId: string,
    sessionId: string,
    handoffId: string,
  ): Promise<void> {
    this.pendingTransfers.delete(providerCallId);
    this.logger.warn(`Transfer timeout for session ${sessionId} — recovering to AI`);
    await this.recoverToAi(sessionId, handoffId, 'timeout');
  }

  private async onTransferFailed(
    sessionId: string,
    handoffId: string,
    reason: string,
  ): Promise<void> {
    this.logger.warn(`Transfer failed for session ${sessionId}: ${reason}`);
    await this.recoverToAi(sessionId, handoffId, 'failed');
  }

  private async recoverToAi(
    sessionId: string,
    handoffId: string,
    reason: 'timeout' | 'failed',
  ): Promise<void> {
    await this.handoffRepo.update(handoffId, { status: 'declined' });
    await this.sessionService.updateStatus(sessionId, 'ai_handling');
    await this.sessionService.updateHandoffStatus(sessionId, 'none');
    await this.sessionService.appendEvent(sessionId, 'provider_webhook', {
      reason: 'transfer_recovered',
      originalReason: reason,
    });

    const session = await this.sessionService.findById(sessionId);
    const lang = session?.language ?? 'ru';
    const recoveryPhrase = getSafeResponse('low_confidence', lang);

    this.realtimeService.emitAiStateChanged(sessionId, 'ai_speaking');
    this.realtimeService.emitCallUpdated(sessionId, {
      status: 'ai_handling',
      handoffStatus: 'none',
      transferRecovery: { reason },
    });

    this.logger.log(`AI recovered for session ${sessionId}, phrase: "${recoveryPhrase}"`);
  }

  // ── Warm transfer briefing ────────────────────────────────────────────────

  async buildBriefing(
    sessionId: string,
    escalationReason: string,
  ): Promise<WarmTransferBriefing> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) {
      return {
        sessionId,
        guestPhone: null,
        propertyName: null,
        propertyAddress: null,
        guestName: null,
        checkIn: null,
        checkOut: null,
        lastIntent: null,
        escalationReason,
        lastAiResponse: null,
        turnCount: 0,
        avgLatencyMs: null,
        transcriptSnippet: '',
      };
    }

    const [property, booking, lastSegments] = await Promise.all([
      session.propertyId
        ? this.propertyRepo.findOne({ where: { id: session.propertyId } })
        : Promise.resolve(null),
      session.reservationId
        ? this.bookingRepo.findOne({ where: { id: session.reservationId } })
        : Promise.resolve(null),
      this.segmentRepo.find({
        where: { sessionId },
        order: { turnIndex: 'DESC' },
        take: 6,
      }),
    ]);

    const sortedSnippet = [...lastSegments].reverse();
    const transcriptSnippet = sortedSnippet
      .map((s) => `[${s.role.toUpperCase()}] ${s.content}`)
      .join('\n');

    const lastAiSeg = lastSegments.find((s) => s.role === 'ai');
    const lastIntent = lastAiSeg?.intent ?? null;
    const lastAiResponse = lastAiSeg?.content ?? null;

    return {
      sessionId,
      guestPhone: session.guestPhone,
      propertyName: property?.name ?? null,
      propertyAddress: property?.address ?? null,
      guestName: booking?.guestName ?? null,
      checkIn: booking?.checkIn.toLocaleDateString('ru-RU') ?? null,
      checkOut: booking?.checkOut.toLocaleDateString('ru-RU') ?? null,
      lastIntent,
      escalationReason,
      lastAiResponse,
      turnCount: session.turnCount,
      avgLatencyMs: session.avgTurnLatencyMs,
      transcriptSnippet,
    };
  }
}
