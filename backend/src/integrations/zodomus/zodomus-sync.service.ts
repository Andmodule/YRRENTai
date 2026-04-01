import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { addDays, isValid, parseISO } from 'date-fns';
import { BOOKING_STATUS } from '@rentai/shared';
import { BookingEntity } from '../../booking/entities/booking.entity';
import type { PropertyEntity } from '../../property/entities/property.entity';
import { PropertyService } from '../../property/property.service';
import { ZodomusService } from './zodomus.service';
import type { ZodomusReservation, ZodomusReservationQueueItem } from './zodomus.types';

/** Zodomus queue status codes per official docs */
const QUEUE_STATUS = {
  NEW: 1,
  MODIFIED: 2,
  CANCELLED: 3,
} as const;

@Injectable()
export class ZodomusSyncService {
  private readonly logger = new Logger(ZodomusSyncService.name);

  constructor(
    private readonly zodomus: ZodomusService,
    private readonly propertyService: PropertyService,
    @InjectRepository(BookingEntity)
    private readonly bookingRepo: Repository<BookingEntity>,
  ) {}

  /**
   * Pull reservation queue for one property (must have `zodomusPropertyId`), upsert/cancel bookings.
   * @param force — заново GET /reservations и upsert даже если бронь уже помечена `zodomusSynced`.
   */
  async syncQueueForProperty(
    ownerUserId: string,
    internalPropertyId: string,
    channelId: number,
    force = false,
  ): Promise<{ processed: number; skipped: number; failed: number }> {
    if (!this.zodomus.isEnabled) {
      throw new BadRequestException('Zodomus is disabled');
    }
    const property = await this.propertyService.findOne(internalPropertyId, ownerUserId);
    return this.syncQueueRaw(property, channelId, force);
  }

  /**
   * Синхронизация очереди для всех объектов владельца с `zodomusPropertyId`.
   */
  async syncAllForUser(
    ownerUserId: string,
    channelId: number,
    force = false,
  ): Promise<{ processed: number; skipped: number; failed: number; propertiesTouched: number }> {
    if (!this.zodomus.isEnabled) {
      throw new BadRequestException('Zodomus is disabled');
    }
    const list = await this.propertyService.findAllByOwner(ownerUserId);
    return this.aggregateSync(list, channelId, force);
  }

  /**
   * Синхронизация очереди для всех объектов в системе (используется cron-сервисом).
   */
  async syncAllProperties(channelId: number): Promise<{ processed: number; skipped: number; failed: number; propertiesTouched: number }> {
    if (!this.zodomus.isEnabled) return { processed: 0, skipped: 0, failed: 0, propertiesTouched: 0 };
    const list = await this.propertyService.findAllWithZodomus();
    return this.aggregateSync(list, channelId, false);
  }

  /**
   * Обработка одного входящего webhook-события от Zodomus.
   * status: 1=new, 2=modified, 3=cancelled.
   */
  async processWebhookEvent(
    zodomusPropertyId: string,
    channelId: number,
    reservationId: string,
    reservationStatus: number,
  ): Promise<void> {
    const property = await this.propertyService.findByZodomusPropertyId(zodomusPropertyId);
    if (!property) {
      this.logger.warn(`Webhook: no property found for zodomusPropertyId=${zodomusPropertyId}`);
      return;
    }

    const rid = String(reservationId ?? '').trim();
    if (!rid) return;

    if (reservationStatus === QUEUE_STATUS.CANCELLED) {
      await this.cancelBookingByReservationId(rid);
      return;
    }

    // status 1 (new) or 2 (modified): fetch full reservation and upsert
    try {
      const reservation = await this.zodomus.getReservation(channelId, rid, zodomusPropertyId);
      const existing = await this.bookingRepo.findOne({ where: { zodomusReservationId: rid } });
      await this.upsertBooking(property, channelId, reservation, existing, rid);
      const row = await this.bookingRepo.findOne({ where: { zodomusReservationId: rid } });
      if (row) { row.zodomusSynced = true; await this.bookingRepo.save(row); }
    } catch (e) {
      this.logger.error(`Webhook upsert failed for reservation ${rid}: ${String(e)}`);
      throw e;
    }
  }

  /**
   * Импортирует активные брони через GET /reservations-summary (для онбординга объекта).
   */
  async importSummaryForProperty(
    ownerUserId: string,
    internalPropertyId: string,
    channelId: number,
  ): Promise<{ imported: number; failed: number }> {
    if (!this.zodomus.isEnabled) throw new BadRequestException('Zodomus is disabled');

    const property = await this.propertyService.findOne(internalPropertyId, ownerUserId);
    const extId = property.zodomusPropertyId?.trim();
    if (!extId) throw new BadRequestException('Set zodomusPropertyId on the property');

    const reservations = await this.zodomus.getReservationSummary(channelId, extId);
    let imported = 0;
    let failed = 0;

    for (const res of reservations) {
      const rid = String(res.reservationId ?? res.id ?? '').trim();
      if (!rid) continue;
      try {
        const existing = await this.bookingRepo.findOne({ where: { zodomusReservationId: rid } });
        await this.upsertBooking(property, channelId, res, existing, rid);
        const row = await this.bookingRepo.findOne({ where: { zodomusReservationId: rid } });
        if (row) { row.zodomusSynced = true; await this.bookingRepo.save(row); }
        imported += 1;
      } catch (e) {
        failed += 1;
        this.logger.warn(`importSummary failed for ${rid}: ${String(e)}`);
      }
    }

    return { imported, failed };
  }

  // ── private helpers ──────────────────────────────────────────────────────────

  private async aggregateSync(
    list: PropertyEntity[],
    channelId: number,
    force: boolean,
  ): Promise<{ processed: number; skipped: number; failed: number; propertiesTouched: number }> {
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let propertiesTouched = 0;
    for (const p of list) {
      if (!p.zodomusPropertyId?.trim()) continue;
      propertiesTouched += 1;
      try {
        const r = await this.syncQueueRaw(p, channelId, force);
        processed += r.processed;
        skipped += r.skipped;
        failed += r.failed;
      } catch (e) {
        failed += 1;
        this.logger.warn(`syncAllProperties: property ${p.id} failed: ${String(e)}`);
      }
    }
    return { processed, skipped, failed, propertiesTouched };
  }

  /** Core queue loop — operates on a PropertyEntity directly (no ownerId needed). */
  private async syncQueueRaw(
    property: PropertyEntity,
    channelId: number,
    force: boolean,
  ): Promise<{ processed: number; skipped: number; failed: number }> {
    const extId = property.zodomusPropertyId?.trim();
    if (!extId) {
      throw new BadRequestException('Set zodomusPropertyId on the property (Zodomus external id)');
    }

    const queue = await this.zodomus.getReservationQueue(channelId, extId);
    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const item of queue) {
      const rid = String(item.reservationId ?? item.id ?? '').trim();
      if (!rid) continue;

      const existing = await this.bookingRepo.findOne({ where: { zodomusReservationId: rid } });

      // status=3 (cancelled) — cancel immediately without GET /reservations
      if (this.queueItemIsCancelled(item)) {
        try {
          await this.cancelBookingByReservationId(rid);
          processed += 1;
        } catch (e) {
          failed += 1;
          this.logger.warn(`Cancel failed for ${rid}: ${String(e)}`);
        }
        continue;
      }

      if (!force && existing?.zodomusSynced) {
        skipped += 1;
        continue;
      }

      try {
        // Calling GET /reservations automatically removes item from queue (no separate ACK needed)
        const reservation = await this.zodomus.getReservation(channelId, rid, extId);
        await this.upsertBooking(property, channelId, reservation, existing, rid);

        const row = await this.bookingRepo.findOne({ where: { zodomusReservationId: rid } });
        if (row) {
          row.zodomusSynced = true;
          await this.bookingRepo.save(row);
        }
        processed += 1;
      } catch (e) {
        failed += 1;
        this.logger.warn(`Zodomus sync failed for reservation ${rid}: ${String(e)}`);
      }
    }

    return { processed, skipped, failed };
  }

  /** Returns true when the queue item signals a cancellation (numeric status=3 OR action string). */
  private queueItemIsCancelled(item: ZodomusReservationQueueItem): boolean {
    if (item.status === QUEUE_STATUS.CANCELLED) return true;
    const action = String(item.action ?? '').toLowerCase();
    return action.includes('cancel') || action.includes('delete');
  }

  private async cancelBookingByReservationId(rid: string): Promise<void> {
    const row = await this.bookingRepo.findOne({ where: { zodomusReservationId: rid } });
    if (!row) {
      this.logger.log(`Cancel: reservation ${rid} not found in DB — skipped`);
      return;
    }
    if (row.status === BOOKING_STATUS.CANCELLED) return; // already cancelled
    row.status = BOOKING_STATUS.CANCELLED;
    row.zodomusSynced = true;
    await this.bookingRepo.save(row);
    this.logger.log(`Cancelled booking ${row.id} (zodomusReservationId=${rid})`);
  }

  private async upsertBooking(
    property: PropertyEntity,
    channelId: number,
    raw: ZodomusReservation,
    existing: BookingEntity | null,
    queueReservationId: string,
  ): Promise<void> {
    const rid = String(raw.reservationId ?? raw.id ?? queueReservationId ?? '').trim();
    if (!rid) {
      this.logger.warn('Zodomus reservation without reservationId');
      return;
    }

    const guestName =
      [raw.guestFirstName, raw.guestLastName].filter(Boolean).join(' ').trim() ||
      String(raw.guestName ?? '').trim() ||
      'Guest';

    let checkIn = parseZodomusDate(raw.checkIn);
    let checkOut = parseZodomusDate(raw.checkOut);
    if (!checkIn) checkIn = new Date();
    if (!checkOut) checkOut = addDays(checkIn, 1);
    if (checkOut.getTime() <= checkIn.getTime()) checkOut = addDays(checkIn, 1);

    const totalMinor = Math.round(Number(raw.totalPrice ?? 0) * 100);
    const currency = String(raw.currency || property.currency || 'USD').slice(0, 3);

    const row =
      existing ??
      this.bookingRepo.create({
        propertyId: property.id,
        createdBy: property.ownerId,
        status: BOOKING_STATUS.PENDING,
        zodomusReservationId: rid,
        zodomusChannelId: channelId,
        zodomusSynced: false,
      });

    row.guestName = guestName;
    if (raw.guestEmail) row.guestEmail = raw.guestEmail;
    row.checkIn = checkIn;
    row.checkOut = checkOut;
    row.totalPriceMinor = Number.isFinite(totalMinor) ? totalMinor : 0;
    row.currency = currency;
    row.zodomusReservationId = rid;
    row.zodomusChannelId = channelId;
    row.zodomusSynced = false;
    row.status = mapZodomusReservationStatus(raw.status);

    await this.bookingRepo.save(row);
  }
}

function parseZodomusDate(raw: unknown): Date | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return isValid(raw) ? raw : null;
  const d = parseISO(String(raw).trim());
  return isValid(d) ? d : null;
}

/**
 * Maps the reservation-level `status` field (string from GET /reservations body).
 * Queue-level numeric statuses (1/2/3) are handled separately in queueItemIsCancelled().
 */
function mapZodomusReservationStatus(raw: unknown): string {
  const s = String(raw ?? '').toLowerCase().trim();
  if (!s) return BOOKING_STATUS.PENDING;
  // numeric status string from reservation body
  if (s === '1') return BOOKING_STATUS.CONFIRMED;
  if (s === '2') return BOOKING_STATUS.CONFIRMED; // modified — still active
  if (s === '3') return BOOKING_STATUS.CANCELLED;
  // text-based status strings
  if (s.includes('cancel')) return BOOKING_STATUS.CANCELLED;
  if (s.includes('declin')) return BOOKING_STATUS.DECLINED;
  if (s.includes('confirm') || s.includes('ok') || s.includes('book') || s.includes('new')) {
    return BOOKING_STATUS.CONFIRMED;
  }
  return BOOKING_STATUS.PENDING;
}
