import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not, Between, QueryFailedError } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import {
  CallSessionEntity,
  CallStatus,
  HandoffStatus,
  VoiceProvider,
} from './entities/call-session.entity';
import { CallEventEntity, CallEventType } from './entities/call-event.entity';
import { BookingEntity } from '../booking/entities/booking.entity';
import { PropertyEntity } from '../property/entities/property.entity';
import { CallStatusMachine } from './call-status.machine';

interface CreateSessionInput {
  provider: VoiceProvider;
  providerCallId: string | null;
  toNumber: string | null;
  guestPhone: string | null;
}

@Injectable()
export class VoiceSessionService {
  private readonly logger = new Logger(VoiceSessionService.name);

  constructor(
    @InjectRepository(CallSessionEntity)
    private readonly sessionRepo: Repository<CallSessionEntity>,
    @InjectRepository(CallEventEntity)
    private readonly eventRepo: Repository<CallEventEntity>,
    @InjectRepository(BookingEntity)
    private readonly bookingRepo: Repository<BookingEntity>,
    @InjectRepository(PropertyEntity)
    private readonly propertyRepo: Repository<PropertyEntity>,
  ) {}

  async create(input: CreateSessionInput): Promise<CallSessionEntity> {
    const correlationId = uuidv4();
    const propertyId = await this.resolvePropertyByDid(input.toNumber);

    let reservationId: string | null = null;
    if (propertyId && input.guestPhone) {
      reservationId = await this.resolveActiveReservation(propertyId, input.guestPhone);
    }

    const session = this.sessionRepo.create({
      correlationId,
      provider: input.provider,
      providerCallId: input.providerCallId,
      direction: 'inbound',
      status: 'ringing',
      toNumber: input.toNumber,
      guestPhone: input.guestPhone,
      propertyId,
      reservationId,
      handoffStatus: 'none',
      turnCount: 0,
      language: 'ru',
    });

    await this.sessionRepo.save(session);
    await this.appendEvent(session.id, 'session_created', { input, correlationId });

    this.logger.log(`CallSession created: ${session.id} (correlation: ${correlationId})`);
    return session;
  }

  async findById(id: string): Promise<CallSessionEntity | null> {
    return this.sessionRepo.findOne({ where: { id } });
  }

  async findByProviderCallId(providerCallId: string): Promise<CallSessionEntity | null> {
    return this.sessionRepo.findOne({ where: { providerCallId } });
  }

  async findActive(): Promise<CallSessionEntity[]> {
    return this.sessionRepo.find({
      where: [
        { status: 'ringing' },
        { status: 'in_progress' },
        { status: 'ai_handling' },
        { status: 'handoff_pending' },
        { status: 'handed_off' },
      ],
      order: { createdAt: 'DESC' },
    });
  }

  async updateStatus(id: string, status: CallStatus): Promise<void> {
    const session = await this.findById(id);
    if (!session) return;
    if (session.status === status) return; // idempotent
    CallStatusMachine.assertStatusTransition(session.status, status);
    await this.sessionRepo.update(id, { status });
  }

  async markStarted(id: string): Promise<void> {
    const session = await this.findById(id);
    if (!session) return;
    const next: CallStatus = 'ai_handling';
    if (session.status === next) return;
    CallStatusMachine.assertStatusTransition(session.status, next);
    await this.sessionRepo.update(id, { status: next, startedAt: new Date() });
    await this.appendEvent(id, 'session_started', {});
  }

  async markEnded(id: string, endedBy: string, summary?: string): Promise<void> {
    const session = await this.findById(id);
    if (!session) return;
    if (CallStatusMachine.isTerminal(session.status)) return; // already terminal
    CallStatusMachine.assertStatusTransition(session.status, 'completed');
    await this.sessionRepo.update(id, {
      status: 'completed',
      endedAt: new Date(),
      endedBy,
      summary: summary ?? null,
    });
    await this.appendEvent(id, 'session_ended', { endedBy, summary });
  }

  async updateHandoffStatus(id: string, handoffStatus: HandoffStatus): Promise<void> {
    const session = await this.findById(id);
    if (!session) return;
    if (session.handoffStatus === handoffStatus) return;
    CallStatusMachine.assertHandoffTransition(session.handoffStatus, handoffStatus);
    await this.sessionRepo.update(id, { handoffStatus });
  }

  async setTakenOverBy(id: string, userId: string): Promise<void> {
    const session = await this.findById(id);
    if (!session) return;
    // Allow idempotent re-assignment (same operator)
    if (session.takenOverByUserId === userId && session.status === 'handed_off') return;
    CallStatusMachine.assertStatusTransition(session.status, 'handed_off');
    await this.sessionRepo.update(id, {
      takenOverByUserId: userId,
      status: 'handed_off',
      handoffStatus: 'completed',
    });
    await this.appendEvent(id, 'operator_takeover', { userId }, undefined, `takeover:${id}:${userId}`);
  }

  /**
   * Sets the propertyId on a session that started without one (voice name resolution).
   * Idempotent: safe to call multiple times with the same value.
   */
  async setPropertyId(id: string, propertyId: string): Promise<void> {
    await this.sessionRepo.update(id, { propertyId });
    await this.appendEvent(id, 'property_resolved', { propertyId, source: 'voice_name_match' });
  }

  async incrementTurnCount(id: string, latencyMs: number): Promise<void> {
    const session = await this.findById(id);
    if (!session) return;
    const newCount = session.turnCount + 1;
    const prevAvg = session.avgTurnLatencyMs ?? latencyMs;
    const newAvg = Math.round((prevAvg * (newCount - 1) + latencyMs) / newCount);
    await this.sessionRepo.update(id, { turnCount: newCount, avgTurnLatencyMs: newAvg });
  }

  /**
   * Append an audit event with optional idempotency key.
   * Duplicate keys are silently skipped (no-op).
   */
  async appendEvent(
    sessionId: string,
    type: CallEventType,
    payload: Record<string, unknown>,
    latencyMs?: number,
    idempotencyKey?: string,
  ): Promise<void> {
    const event = this.eventRepo.create({
      sessionId,
      type,
      payload,
      latencyMs: latencyMs ?? null,
      idempotencyKey: idempotencyKey ?? null,
    });
    try {
      await this.eventRepo.save(event);
    } catch (err) {
      if (err instanceof QueryFailedError && String(err.message).includes('duplicate')) {
        this.logger.debug(`Duplicate event skipped: ${idempotencyKey}`);
      } else {
        throw err;
      }
    }
  }

  async getSessionWithEvents(id: string): Promise<CallSessionEntity | null> {
    return this.sessionRepo.findOne({
      where: { id },
      relations: ['events', 'transcriptSegments', 'handoffs'],
    });
  }

  private async resolvePropertyByDid(toNumber: string | null): Promise<string | null> {
    if (!toNumber) return null;

    const mapEnv = process.env['INBOUND_DID_PROPERTY_MAP'] ?? '';
    if (mapEnv) {
      for (const pair of mapEnv.split(',')) {
        const [did, pid] = pair.split(':');
        if (did?.trim() === toNumber.trim()) return pid?.trim() ?? null;
      }
    }

    const count = await this.propertyRepo.count();
    if (count === 1) {
      const p = await this.propertyRepo.findOne({ where: {} });
      return p?.id ?? null;
    }
    return null;
  }

  private async resolveActiveReservation(
    propertyId: string,
    guestPhone: string,
  ): Promise<string | null> {
    const normalised = guestPhone.replace(/\D/g, '').slice(-10);
    if (normalised.length < 7) return null;

    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - 3);
    const windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + 14);

    const bookings = await this.bookingRepo.find({
      where: { propertyId, checkIn: Between(windowStart, windowEnd), guestPhone: Not(IsNull()) },
      order: { checkIn: 'ASC' },
    });

    for (const b of bookings) {
      if (b.guestPhone && b.guestPhone.replace(/\D/g, '').slice(-10) === normalised) {
        return b.id;
      }
    }
    return null;
  }
}
