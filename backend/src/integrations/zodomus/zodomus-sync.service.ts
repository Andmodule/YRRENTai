import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { addDays, isValid, parseISO } from 'date-fns';
import { BOOKING_STATUS } from '@rentai/shared';
import { BookingEntity } from '../../booking/entities/booking.entity';
import { PropertyChannelListingEntity } from '../../property/entities/property-channel-listing.entity';
import type { PropertyEntity } from '../../property/entities/property.entity';
import { PropertyService } from '../../property/property.service';
import { CalendarGateway } from '../../calendar/calendar.gateway';
import { ZodomusService } from './zodomus.service';
import { ZodomusAvailabilityPushService } from './zodomus-availability-push.service';
import {
  formatZodomusHttpException,
  isZodomusPermanentMisconfiguration,
  isZodomusReservationDownloadLimitError,
} from './zodomus-status.util';
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
    private readonly config: ConfigService,
    private readonly availabilityPush: ZodomusAvailabilityPushService,
    private readonly calendarGateway: CalendarGateway,
    @InjectRepository(BookingEntity)
    private readonly bookingRepo: Repository<BookingEntity>,
    @InjectRepository(PropertyChannelListingEntity)
    private readonly listingRepo: Repository<PropertyChannelListingEntity>,
  ) {}

  private findListingByChannel(
    property: PropertyEntity,
    channelId: number,
  ): PropertyChannelListingEntity | null {
    for (const row of property.channelListings ?? []) {
      if (row.otaPlatform?.zodomusChannelId === channelId) return row;
    }
    return null;
  }

  private isListingBackoffActive(listing: PropertyChannelListingEntity): boolean {
    const until = listing.zodomusSyncBlockedUntil;
    return Boolean(until && until.getTime() > Date.now());
  }

  private async clearListingBackoff(listingId: string): Promise<void> {
    await this.listingRepo.update(
      { id: listingId },
      {
        zodomusSyncFailCount: 0,
        zodomusSyncBlockedUntil: null,
      },
    );
  }

  private async markListingFailure(
    listing: PropertyChannelListingEntity,
    err: unknown,
    permanent: boolean,
  ): Promise<{ failCount: number; blockedUntil: Date | null }> {
    const nextCount = (listing.zodomusSyncFailCount ?? 0) + 1;
    const now = Date.now();
    let blockedUntil: Date | null = null;

    if (permanent) {
      const mins = this.config.get<number>('ZODOMUS_SYNC_PERMANENT_BLOCK_MINUTES') ?? 1440;
      blockedUntil = new Date(now + mins * 60_000);
    } else if (nextCount >= 3) {
      const base = this.config.get<number>('ZODOMUS_SYNC_SOFT_BACKOFF_MINUTES') ?? 30;
      const scaled = Math.min(24 * 60, base * Math.pow(2, nextCount - 3));
      blockedUntil = new Date(now + scaled * 60_000);
    }

    await this.listingRepo.update(
      { id: listing.id },
      {
        zodomusSyncFailCount: nextCount,
        zodomusSyncBlockedUntil: blockedUntil,
        zodomusSyncLastError: formatZodomusHttpException(err).slice(0, 2000),
        zodomusSyncLastErrorAt: new Date(),
      },
    );
    return { failCount: nextCount, blockedUntil };
  }

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
  async syncAllProperties(
    channelId: number,
    force = false,
  ): Promise<{ processed: number; skipped: number; failed: number; propertiesTouched: number }> {
    if (!this.zodomus.isEnabled) return { processed: 0, skipped: 0, failed: 0, propertiesTouched: 0 };
    const list = await this.propertyService.findAllWithZodomus();
    return this.aggregateSync(list, channelId, force);
  }

  /** SUPERADMIN: same as syncQueueForProperty but without owner scope. */
  async syncQueueForPropertyAdmin(
    internalPropertyId: string,
    channelId: number,
    force = false,
  ): Promise<{ processed: number; skipped: number; failed: number }> {
    if (!this.zodomus.isEnabled) {
      throw new BadRequestException('Zodomus is disabled');
    }
    const property = await this.propertyService.findByIdForAdmin(internalPropertyId);
    return this.syncQueueRaw(property, channelId, force);
  }

  /** SUPERADMIN: import summary for any property by id. */
  async importSummaryForPropertyAdmin(
    internalPropertyId: string,
    channelId: number,
  ): Promise<{ imported: number; failed: number }> {
    if (!this.zodomus.isEnabled) throw new BadRequestException('Zodomus is disabled');

    const property = await this.propertyService.findByIdForAdmin(internalPropertyId);
    const extId = this.propertyService.getExternalListingIdForZodomusChannel(property, channelId);
    if (!extId) throw new BadRequestException('Set an external listing id for this channel on the property');

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
        if (row) {
          row.zodomusSynced = true;
          await this.bookingRepo.save(row);
        }
        imported += 1;
      } catch (e) {
        failed += 1;
        this.logger.warn(`importSummary failed for ${rid}: ${String(e)}`);
      }
    }

    this.availabilityPush.scheduleAvailabilityPush(property.id);
    if (imported > 0 || failed > 0) {
      this.calendarGateway.emitCalendarChanged({ propertyId: property.id, source: 'import-summary:admin' });
    }

    return { imported, failed };
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
      const row = await this.cancelBookingByReservationId(rid);
      if (row) {
        this.availabilityPush.scheduleAvailabilityPush(property.id, {
          dateFromISO: row.checkIn.toISOString(),
          dateToISO: row.checkOut.toISOString(),
        });
        this.calendarGateway.emitCalendarChanged({ propertyId: property.id, source: 'webhook:cancel' });
      }
      return;
    }

    // status 1 (new) or 2 (modified): fetch full reservation and upsert
    try {
      const reservation = await this.zodomus.getReservation(channelId, rid, zodomusPropertyId);
      const existing = await this.bookingRepo.findOne({ where: { zodomusReservationId: rid } });
      const oldCheckIn = existing?.checkIn;
      const oldCheckOut = existing?.checkOut;

      await this.upsertBooking(property, channelId, reservation, existing, rid);
      const row = await this.bookingRepo.findOne({ where: { zodomusReservationId: rid } });
      if (row) { row.zodomusSynced = true; await this.bookingRepo.save(row); }
      
      let minDate = row?.checkIn || oldCheckIn;
      let maxDate = row?.checkOut || oldCheckOut;
      if (oldCheckIn && minDate && oldCheckIn < minDate) minDate = oldCheckIn;
      if (oldCheckOut && maxDate && oldCheckOut > maxDate) maxDate = oldCheckOut;

      this.availabilityPush.scheduleAvailabilityPush(property.id, minDate && maxDate ? {
        dateFromISO: minDate.toISOString(),
        dateToISO: maxDate.toISOString()
      } : undefined);
      this.calendarGateway.emitCalendarChanged({ propertyId: property.id, source: 'webhook:upsert' });
    } catch (e) {
      if (isZodomusReservationDownloadLimitError(e)) {
        const row = await this.bookingRepo.findOne({ where: { zodomusReservationId: rid } });
        if (row && row.propertyId === property.id) {
          row.zodomusSynced = true;
          await this.bookingRepo.save(row);
          this.logger.log(
            `Webhook: reservation ${rid} — GET limit (sandbox); local booking exists → marked synced.`,
          );
          this.availabilityPush.scheduleAvailabilityPush(property.id);
          this.calendarGateway.emitCalendarChanged({ propertyId: property.id, source: 'webhook:limit-skip' });
          return;
        }
      }
      this.logger.error(
        `Webhook upsert failed for reservation ${rid}: ${formatZodomusHttpException(e)}`,
      );
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
    const extId = this.propertyService.getExternalListingIdForZodomusChannel(property, channelId);
    if (!extId) throw new BadRequestException('Set an external listing id for this channel on the property');

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

    this.availabilityPush.scheduleAvailabilityPush(property.id);
    if (imported > 0 || failed > 0) {
      this.calendarGateway.emitCalendarChanged({ propertyId: property.id, source: 'import-summary' });
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
      if (!this.propertyService.getExternalListingIdForZodomusChannel(p, channelId)) continue;
      const listing = this.findListingByChannel(p, channelId);
      if (listing && this.isListingBackoffActive(listing)) {
        skipped += 1;
        this.logger.warn(
          `syncAllProperties: listing ${listing.id} skipped until ${listing.zodomusSyncBlockedUntil?.toISOString()} (property ${p.id}, channel ${channelId})`,
        );
        continue;
      }
      propertiesTouched += 1;
      try {
        const r = await this.syncQueueRaw(p, channelId, force);
        processed += r.processed;
        skipped += r.skipped;
        failed += r.failed;
        if (listing && (listing.zodomusSyncFailCount > 0 || listing.zodomusSyncBlockedUntil)) {
          await this.clearListingBackoff(listing.id);
        }
      } catch (e) {
        failed += 1;
        const permanent = isZodomusPermanentMisconfiguration(e);
        if (listing) {
          const state = await this.markListingFailure(listing, e, permanent);
          if (state.blockedUntil) {
            const mode = permanent ? 'PERMANENT' : 'BACKOFF';
            this.logger.warn(
              `syncAllProperties: listing ${listing.id} ${mode} until ${state.blockedUntil.toISOString()} (property ${p.id}, channel ${channelId}): ${formatZodomusHttpException(e)}`,
            );
          } else {
            this.logger.warn(
              `syncAllProperties: listing ${listing.id} failed x${state.failCount} (property ${p.id}, channel ${channelId}): ${formatZodomusHttpException(e)}`,
            );
          }
        } else {
          this.logger.warn(
            `syncAllProperties: legacy property ${p.id} failed on channel ${channelId}: ${formatZodomusHttpException(e)}`,
          );
        }
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
    const extId = this.propertyService.getExternalListingIdForZodomusChannel(property, channelId);
    if (!extId) {
      throw new BadRequestException(
        'Set an external listing id for this channel on the property (Zodomus external id)',
      );
    }

    const queue = await this.zodomus.getReservationQueue(channelId, extId);
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    /** GET /reservations limit path can save `zodomusSynced` without incrementing `processed`. */
    let calendarDirtyFromLimitSave = false;

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
        await this.pauseAfterQueueItem();
        continue;
      }

      if (!force && existing?.zodomusSynced) {
        skipped += 1;
        await this.pauseAfterQueueItem();
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
        if (isZodomusReservationDownloadLimitError(e)) {
          const row = await this.bookingRepo.findOne({ where: { zodomusReservationId: rid } });
          if (row && row.propertyId === property.id) {
            row.zodomusSynced = true;
            await this.bookingRepo.save(row);
            skipped += 1;
            calendarDirtyFromLimitSave = true;
            this.logger.log(
              `Zodomus: reservation ${rid} — GET /reservations limit reached (sandbox); local booking exists → marked synced, skipping re-fetch.`,
            );
          } else {
            skipped += 1;
            this.logger.warn(
              `Zodomus: reservation ${rid} — GET limit reached (sandbox) and no local booking for this property. Create new test reservations in Zodomus or use Import summary.`,
            );
          }
        } else {
          failed += 1;
          this.logger.warn(
            `Zodomus sync failed for reservation ${rid}: ${formatZodomusHttpException(e)}`,
          );
        }
      }
      await this.pauseAfterQueueItem();
    }

    /** Do not POST /availability on every empty queue poll — only when bookings actually changed (Zodomus / partner rate limits). */
    if (processed > 0 || calendarDirtyFromLimitSave) {
      this.availabilityPush.scheduleAvailabilityPush(property.id);
      this.calendarGateway.emitCalendarChanged({ propertyId: property.id, source: 'sync-queue' });
    }

    return { processed, skipped, failed };
  }

  /** Throttle consecutive queue API calls (Zodomus / channel may reject bursts). */
  private async pauseAfterQueueItem(): Promise<void> {
    const ms = this.config.get<number>('ZODOMUS_QUEUE_ITEM_DELAY_MS') ?? 400;
    if (ms <= 0) return;
    await new Promise((r) => setTimeout(r, ms));
  }

  /** Returns true when the queue item signals a cancellation (numeric status=3 OR action string). */
  private queueItemIsCancelled(item: ZodomusReservationQueueItem): boolean {
    if (item.status === QUEUE_STATUS.CANCELLED) return true;
    const action = String(item.action ?? '').toLowerCase();
    return action.includes('cancel') || action.includes('delete');
  }

  private async cancelBookingByReservationId(rid: string): Promise<BookingEntity | null> {
    const row = await this.bookingRepo.findOne({ where: { zodomusReservationId: rid } });
    if (!row) {
      this.logger.log(`Cancel: reservation ${rid} not found in DB — skipped`);
      return null;
    }
    if (row.status === BOOKING_STATUS.CANCELLED) return row; // already cancelled
    row.status = BOOKING_STATUS.CANCELLED;
    row.zodomusSynced = true;
    await this.bookingRepo.save(row);
    this.logger.log(`Cancelled booking ${row.id} (zodomusReservationId=${rid})`);
    return row;
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

    const phoneStr =
      raw.guestPhone != null && String(raw.guestPhone).trim() !== ''
        ? String(raw.guestPhone).trim()
        : undefined;
    if (raw.guestPhone !== undefined) {
      row.guestPhone = phoneStr;
    }

    const gc = raw.guestsCount;
    if (gc !== undefined && gc !== null) {
      const n = Number(gc);
      if (Number.isFinite(n) && n > 0) {
        row.guestsCount = Math.min(999, Math.round(n));
      }
    }

    if (raw.guestBreakdownFromRoom === true) {
      const a = raw.guestAdults;
      const c = raw.guestChildren;
      if (a !== undefined && a !== null && Number.isFinite(Number(a))) {
        row.guestsAdults = Math.min(999, Math.max(0, Math.round(Number(a))));
      }
      if (c !== undefined && c !== null && Number.isFinite(Number(c))) {
        row.guestsChildren = Math.min(999, Math.max(0, Math.round(Number(c))));
      }
    } else if (raw.guestBreakdownFromRoom === false) {
      row.guestsAdults = undefined;
      row.guestsChildren = undefined;
    }

    if (raw.notes !== undefined) {
      const nt = raw.notes == null ? '' : String(raw.notes).trim();
      row.notes = nt.length > 0 ? nt : undefined;
    }

    row.checkIn = checkIn;
    row.checkOut = checkOut;
    row.totalPriceMinor = Number.isFinite(totalMinor) ? totalMinor : 0;
    row.currency = currency;
    row.zodomusReservationId = rid;
    row.zodomusChannelId = channelId;
    row.zodomusSynced = false;
    row.status = mapZodomusReservationStatus(raw.status);

    const hint = typeof raw.otaPaymentHint === 'string' ? raw.otaPaymentHint.trim().slice(0, 512) : '';
    row.otaPaymentHint = hint.length > 0 ? hint : null;

    await this.bookingRepo.save(row);

    this.logger.debug(
      `Zodomus upsert reservationId=${rid}: email=${Boolean(row.guestEmail?.trim())} phone=${Boolean(row.guestPhone?.trim())} guestsCount=${row.guestsCount ?? '—'} adults=${row.guestsAdults ?? '—'} children=${row.guestsChildren ?? '—'}`,
    );
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
