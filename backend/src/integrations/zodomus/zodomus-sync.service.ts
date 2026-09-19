import { BadRequestException, BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { addDays, isValid, parseISO } from 'date-fns';
import { BOOKING_STATUS, BOOKING_STATUSES_BLOCKING_AVAILABILITY } from '@rentai/shared';
import { BookingEntity } from '../../booking/entities/booking.entity';
import {
  calendarDayToInstantInTimezone,
  formatCalendarDayInTimezone,
} from '../../booking/booking-availability.util';
import { PropertyChannelListingEntity } from '../../property/entities/property-channel-listing.entity';
import type { PropertyEntity } from '../../property/entities/property.entity';
import { PropertyService } from '../../property/property.service';
import { CalendarGateway } from '../../calendar/calendar.gateway';
import { GuestService } from '../../guest/guest.service';
import { ZodomusService } from './zodomus.service';
import { ZodomusAvailabilityPushService } from './zodomus-availability-push.service';
import {
  deriveZodomusPropertyStatus,
  formatZodomusHttpException,
  isZodomusPermanentMisconfiguration,
  isZodomusReservationDownloadLimitError,
} from './zodomus-status.util';
import { applyOverbookingFlag as markOverbooking, clearOverbookingFlag } from './zodomus-overbooking.util';
import type { ZodomusReservation, ZodomusReservationQueueItem } from './zodomus.types';
import { ZODOMUS_BOOKING_FLOW } from './zodomus-booking-flow.constants';
import {
  collectOtaBlockedDays,
  collectOtaNightlyPriceMeta,
  collectOtaNightlyPrices,
  collectOtaNightlyPricesFrom,
  collectOtaRestrictionHints,
  evaluateStayAgainstInventory,
  extractZodomusInventoryDays,
  sumStayNightlyPrices,
  type OtaCalendarRestrictionHint,
  type OtaNightlyPriceMeta,
  type OtaStayInventoryResult,
} from './zodomus-inventory.util';
import { buildRateNameMapFromRoomRates, pickPrimaryRateId } from './zodomus-room-rates.util';

/** Zodomus queue status codes per official docs (inbound only — see ZODOMUS_BOOKING_FLOW). */
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
    private readonly guestService: GuestService,
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
    const result = await this.importSummaryRaw(property, channelId, { skipAvailabilityPush: false });
    if (result.imported > 0 || result.failed > 0) {
      this.calendarGateway.emitCalendarChanged({ propertyId: property.id, source: 'import-summary:admin' });
    }
    return { imported: result.imported, failed: result.failed };
  }

  /**
   * Probe Zodomus via POST /property-check and persist `zodomusStatus`.
   * Do not infer Active from queue/summary success alone (queue can lag or mislead).
   */
  async refreshPropertyStatuses(opts: {
    channelId: number;
    properties: PropertyEntity[];
  }): Promise<{
    checked: number;
    results: Array<{
      propertyId: string;
      status: string | null;
      detail: string | null;
    }>;
  }> {
    if (!this.zodomus.isEnabled) {
      throw new BadRequestException('Zodomus is disabled');
    }
    const results: Array<{ propertyId: string; status: string | null; detail: string | null }> = [];
    for (const p of opts.properties) {
      const extId = this.propertyService.getExternalListingIdForZodomusChannel(p, opts.channelId);
      if (!extId) {
        await this.propertyService.setZodomusStatus(p.id, null, null);
        results.push({ propertyId: p.id, status: null, detail: null });
        continue;
      }
      const { status, detail } = await this.persistStatusFromPropertyCheck(
        p.id,
        opts.channelId,
        extId,
      );
      results.push({ propertyId: p.id, status, detail });
    }
    return { checked: results.length, results };
  }

  /**
   * Source of truth for CRM `zodomusStatus`: POST /property-check (not reservations-queue).
   */
  private async persistStatusFromPropertyCheck(
    propertyId: string,
    channelId: number,
    extId: string,
  ): Promise<{ status: string; detail: string | null }> {
    try {
      await this.zodomus.checkProperty(channelId, extId);
      await this.propertyService.setZodomusStatus(propertyId, 'active', null);
      return { status: 'active', detail: null };
    } catch (e) {
      const detail = formatZodomusHttpException(e);
      const status = deriveZodomusPropertyStatus(detail);
      await this.propertyService.setZodomusStatus(propertyId, status, detail);
      return { status, detail };
    }
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

    // Inbound cancel only (ZODOMUS_BOOKING_FLOW.INBOUND_CANCEL) — no outbound reservation-write.
    if (reservationStatus === QUEUE_STATUS.CANCELLED) {
      const row = await this.cancelBookingByReservationId(rid);
      if (row) {
        this.availabilityPush.scheduleAvailabilityPush(property.id, {
          dateFromISO: row.checkIn.toISOString(),
          dateToISO: row.checkOut.toISOString(),
        });
        this.calendarGateway.emitCalendarChanged({
          propertyId: property.id,
          source: ZODOMUS_BOOKING_FLOW.INBOUND_CANCEL,
        });
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
      this.calendarGateway.emitCalendarChanged({
        propertyId: property.id,
        source: ZODOMUS_BOOKING_FLOW.INBOUND_UPSERT,
      });
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
    const result = await this.importSummaryRaw(property, channelId, { skipAvailabilityPush: false });
    if (result.imported > 0 || result.failed > 0) {
      this.calendarGateway.emitCalendarChanged({ propertyId: property.id, source: 'import-summary' });
    }
    return { imported: result.imported, failed: result.failed };
  }

  /**
   * Before CRM direct create / conflict-preview: pull live OTA reservations into local DB
   * (queue + reservations-summary) so overlap checks see Booking.com occupancy.
   * Soft no-op when Zodomus is off or property has no external listing.
   * Hard-fail (502) when a linked channel returns API errors — do not create locally on stale data.
   */
  async pullLiveOtaBookingsForDirectBooking(
    property: PropertyEntity,
  ): Promise<{
    attempted: boolean;
    channels: number[];
    imported: number;
    queueProcessed: number;
    errors: string[];
  }> {
    if (!this.zodomus.isEnabled) {
      return { attempted: false, channels: [], imported: 0, queueProcessed: 0, errors: [] };
    }

    const channelIds = this.resolveLinkedZodomusChannelIds(property);
    if (channelIds.length === 0) {
      return { attempted: false, channels: [], imported: 0, queueProcessed: 0, errors: [] };
    }

    let imported = 0;
    let queueProcessed = 0;
    const errors: string[] = [];

    for (const channelId of channelIds) {
      try {
        const summary = await this.importSummaryRaw(property, channelId, {
          skipAvailabilityPush: true,
        });
        imported += summary.imported;
      } catch (e) {
        const detail = formatZodomusHttpException(e);
        errors.push(`summary ch=${channelId}: ${detail}`);
        this.logger.warn(
          `pullLiveOta (create/preview) summary failed property=${property.id} channel=${channelId}: ${detail}`,
        );
      }

      try {
        const queue = await this.syncQueueRaw(property, channelId, true);
        queueProcessed += queue.processed;
      } catch (e) {
        const detail = formatZodomusHttpException(e);
        errors.push(`queue ch=${channelId}: ${detail}`);
        this.logger.warn(
          `pullLiveOta (create/preview) queue failed property=${property.id} channel=${channelId}: ${detail}`,
        );
      }
    }

    if (imported > 0 || queueProcessed > 0) {
      this.calendarGateway.emitCalendarChanged({
        propertyId: property.id,
        source: 'pull-live-before-direct',
      });
    }

    this.logger.log(
      `pullLiveOta before direct booking property=${property.id} channels=${channelIds.join(',')} imported=${imported} queueProcessed=${queueProcessed} errors=${errors.length}`,
    );

    if (errors.length > 0) {
      throw new BadGatewayException({
        error: 'ZODOMUS_LIVE_PULL_FAILED',
        message: `Zodomus live OTA pull failed — local booking blocked: ${errors.join('; ')}`,
        upstream: 'zodomus',
        detail: errors.join('; '),
      });
    }

    return {
      attempted: true,
      channels: channelIds,
      imported,
      queueProcessed,
      errors,
    };
  }

  /**
   * Soft live pull for calendar refresh — logs channel errors but does not throw.
   * Emits calendar WS event when any bookings were imported so the grid can refetch.
   */
  async pullLiveOtaBookingsSoft(property: PropertyEntity): Promise<void> {
    if (!this.zodomus.isEnabled) return;
    const channelIds = this.resolveLinkedZodomusChannelIds(property);
    if (channelIds.length === 0) return;

    let imported = 0;
    let queueProcessed = 0;
    for (const channelId of channelIds) {
      try {
        const summary = await this.importSummaryRaw(property, channelId, {
          skipAvailabilityPush: true,
        });
        imported += summary.imported;
      } catch (e) {
        this.logger.warn(
          `pullLiveOta (calendar soft) summary failed property=${property.id} channel=${channelId}: ${formatZodomusHttpException(e)}`,
        );
      }
      try {
        const queue = await this.syncQueueRaw(property, channelId, false);
        queueProcessed += queue.processed;
      } catch (e) {
        this.logger.warn(
          `pullLiveOta (calendar soft) queue failed property=${property.id} channel=${channelId}: ${formatZodomusHttpException(e)}`,
        );
      }
    }

    if (imported > 0 || queueProcessed > 0) {
      this.calendarGateway.emitCalendarChanged({
        propertyId: property.id,
        source: 'calendar-soft-pull',
      });
    }
  }

  /**
   * GET /availability for linked channels and evaluate stay vs inventory + restrictions.
   * No-op ok when Zodomus off or property not linked.
   */
  async assertStayAllowedByOtaInventory(
    property: PropertyEntity,
    checkIn: Date,
    checkOut: Date,
    nights: number,
  ): Promise<
    OtaStayInventoryResult & { checked: boolean; suggestedTotalMajor: number | null }
  > {
    if (!this.zodomus.isEnabled) {
      return { ok: true, checked: false, suggestedTotalMajor: null };
    }
    const channelIds = this.resolveLinkedZodomusChannelIds(property);
    if (channelIds.length === 0) {
      return { ok: true, checked: false, suggestedTotalMajor: null };
    }

    const tz = property.timezone?.trim() || 'UTC';
    const checkInYmd = formatCalendarDayInTimezone(checkIn, tz);
    const checkOutYmd = formatCalendarDayInTimezone(checkOut, tz);
    const errors: string[] = [];
    let suggestedTotalMajor: number | null = null;

    for (const channelId of channelIds) {
      const extId = this.propertyService.getExternalListingIdForZodomusChannel(property, channelId);
      if (!extId) continue;
      try {
        const preferRoomId = this.propertyService.getZodomusRoomIdForChannel(property, channelId);
        let preferRateId: string | null = null;
        let rateNamesById: Record<string, string> | null = null;
        try {
          const ratesRaw = await this.zodomus.getRoomRatesRaw(channelId, extId);
          preferRateId = pickPrimaryRateId(ratesRaw, preferRoomId);
          rateNamesById = buildRateNameMapFromRoomRates(ratesRaw);
        } catch {
          /* soft: fall back to cheapest open rate */
        }
        const raw = await this.zodomus.getAvailability(channelId, extId, checkInYmd, checkOutYmd);
        const days = extractZodomusInventoryDays(raw, {
          preferRoomId,
          preferRateId,
          rateNamesById,
        });
        if (suggestedTotalMajor == null) {
          suggestedTotalMajor = sumStayNightlyPrices(days, checkInYmd, checkOutYmd);
        }
        const result = evaluateStayAgainstInventory(days, checkInYmd, checkOutYmd, nights);
        if (!result.ok) {
          return { ...result, checked: true, suggestedTotalMajor };
        }
      } catch (e) {
        const detail = formatZodomusHttpException(e);
        errors.push(`availability ch=${channelId}: ${detail}`);
        this.logger.warn(
          `OTA inventory check failed property=${property.id} channel=${channelId}: ${detail}`,
        );
      }
    }

    if (errors.length > 0) {
      throw new BadGatewayException({
        error: 'ZODOMUS_AVAILABILITY_CHECK_FAILED',
        message: `Zodomus availability check failed — local booking blocked: ${errors.join('; ')}`,
        upstream: 'zodomus',
        detail: errors.join('; '),
      });
    }

    return { ok: true, checked: true, suggestedTotalMajor };
  }

  /**
   * Calendar overlay: blocked nights (avail=0/booked) + restriction hints from GET /availability.
   * Soft-fails per property/channel (returns empty overlay on errors).
   */
  async getInventoryOverlayForProperty(
    property: PropertyEntity,
    dateFromYmd: string,
    dateToYmd: string,
  ): Promise<{
    blockedDays: string[];
    restrictions: OtaCalendarRestrictionHint[];
    nightlyPrices: Record<string, number>;
    nightlyPricesFrom: Record<string, number>;
    nightlyPriceMeta: Record<string, OtaNightlyPriceMeta>;
  }> {
    const empty = {
      blockedDays: [] as string[],
      restrictions: [] as OtaCalendarRestrictionHint[],
      nightlyPrices: {} as Record<string, number>,
      nightlyPricesFrom: {} as Record<string, number>,
      nightlyPriceMeta: {} as Record<string, OtaNightlyPriceMeta>,
    };
    if (!this.zodomus.isEnabled) {
      return empty;
    }
    const channelIds = this.resolveLinkedZodomusChannelIds(property);
    if (channelIds.length === 0) {
      return empty;
    }

    const blocked = new Set<string>();
    const restrictions: OtaCalendarRestrictionHint[] = [];
    const nightlyPrices: Record<string, number> = {};
    const nightlyPricesFrom: Record<string, number> = {};
    const nightlyPriceMeta: Record<string, OtaNightlyPriceMeta> = {};
    const seenHint = new Set<string>();

    for (const channelId of channelIds) {
      const extId = this.propertyService.getExternalListingIdForZodomusChannel(property, channelId);
      if (!extId) continue;
      try {
        const preferRoomId = this.propertyService.getZodomusRoomIdForChannel(property, channelId);
        let preferRateId: string | null = null;
        let rateNamesById: Record<string, string> | null = null;
        try {
          const ratesRaw = await this.zodomus.getRoomRatesRaw(channelId, extId);
          preferRateId = pickPrimaryRateId(ratesRaw, preferRoomId);
          rateNamesById = buildRateNameMapFromRoomRates(ratesRaw);
        } catch (e) {
          this.logger.debug(
            `calendar overlay room-rates skip property=${property.id} ch=${channelId}: ${formatZodomusHttpException(e)}`,
          );
        }
        const raw = await this.zodomus.getAvailability(channelId, extId, dateFromYmd, dateToYmd);
        const days = extractZodomusInventoryDays(raw, {
          preferRoomId,
          preferRateId,
          rateNamesById,
        });
        const blockedDays = collectOtaBlockedDays(days);
        for (const d of blockedDays) blocked.add(d);
        this.logger.debug(
          `calendar overlay property=${property.id} ch=${channelId} ext=${extId} room=${preferRoomId ?? 'all'} days=${days.length} blocked=${blockedDays.length}`,
        );
        for (const h of collectOtaRestrictionHints(days)) {
          const key = `${h.date}:${h.kind}:${h.minStay ?? ''}`;
          if (seenHint.has(key)) continue;
          seenHint.add(key);
          restrictions.push(h);
        }
        // First linked channel wins per date (Booking.com channel typically).
        for (const [date, price] of Object.entries(collectOtaNightlyPrices(days))) {
          if (nightlyPrices[date] == null) nightlyPrices[date] = price;
        }
        for (const [date, price] of Object.entries(collectOtaNightlyPricesFrom(days))) {
          if (nightlyPricesFrom[date] == null) nightlyPricesFrom[date] = price;
        }
        for (const [date, meta] of Object.entries(collectOtaNightlyPriceMeta(days))) {
          if (nightlyPriceMeta[date] == null) nightlyPriceMeta[date] = meta;
        }
      } catch (e) {
        this.logger.warn(
          `calendar inventory overlay failed property=${property.id} channel=${channelId}: ${formatZodomusHttpException(e)}`,
        );
      }
    }

    return {
      blockedDays: [...blocked].sort(),
      restrictions,
      nightlyPrices,
      nightlyPricesFrom,
      nightlyPriceMeta,
    };
  }

  isPropertyZodomusLinked(property: PropertyEntity): boolean {
    return this.resolveLinkedZodomusChannelIds(property).length > 0;
  }

  // ── private helpers ──────────────────────────────────────────────────────────

  private resolveLinkedZodomusChannelIds(property: PropertyEntity): number[] {
    const ids = new Set<number>();
    for (const row of property.channelListings ?? []) {
      const ch = row.otaPlatform?.zodomusChannelId;
      if (typeof ch !== 'number' || !Number.isFinite(ch)) continue;
      if (this.propertyService.getExternalListingIdForZodomusChannel(property, ch)) {
        ids.add(ch);
      }
    }
    if (ids.size === 0 && property.zodomusPropertyId?.trim()) {
      ids.add(1);
    }
    return [...ids].sort((a, b) => a - b);
  }

  private async importSummaryRaw(
    property: PropertyEntity,
    channelId: number,
    opts: { skipAvailabilityPush: boolean },
  ): Promise<{ imported: number; failed: number }> {
    const extId = this.propertyService.getExternalListingIdForZodomusChannel(property, channelId);
    if (!extId) {
      throw new BadRequestException('Set an external listing id for this channel on the property');
    }

    let reservations;
    try {
      reservations = await this.zodomus.getReservationSummary(channelId, extId);
      await this.persistStatusFromPropertyCheck(property.id, channelId, extId);
    } catch (e) {
      const detail = formatZodomusHttpException(e);
      await this.propertyService.setZodomusStatus(
        property.id,
        deriveZodomusPropertyStatus(detail),
        detail,
      );
      throw e;
    }

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

    if (!opts.skipAvailabilityPush) {
      this.availabilityPush.scheduleAvailabilityPush(property.id);
    }

    return { imported, failed };
  }

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
        const detail = formatZodomusHttpException(e);
        const permanent = isZodomusPermanentMisconfiguration(e);
        if (listing) {
          const state = await this.markListingFailure(listing, e, permanent);
          if (state.blockedUntil) {
            const mode = permanent ? 'PERMANENT' : 'BACKOFF';
            this.logger.warn(
              `syncAllProperties: listing ${listing.id} ${mode} until ${state.blockedUntil.toISOString()} (property ${p.id}, channel ${channelId}): ${detail}`,
            );
          } else {
            this.logger.warn(
              `syncAllProperties: listing ${listing.id} failed x${state.failCount} (property ${p.id}, channel ${channelId}): ${detail}`,
            );
          }
        } else {
          this.logger.warn(
            `syncAllProperties: legacy property ${p.id} failed on channel ${channelId}: ${detail}`,
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

    let queue;
    try {
      queue = await this.zodomus.getReservationQueue(channelId, extId);
    } catch (e) {
      const detail = formatZodomusHttpException(e);
      await this.propertyService.setZodomusStatus(
        property.id,
        deriveZodomusPropertyStatus(detail),
        detail,
      );
      throw e;
    }
    await this.persistStatusFromPropertyCheck(property.id, channelId, extId);
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    /** GET /reservations limit path can save `zodomusSynced` without incrementing `processed`. */
    let calendarDirtyFromLimitSave = false;
    /** Widen delta push window when queue cancels/upserts change stay dates. */
    let pushMinDate: Date | undefined;
    let pushMaxDate: Date | undefined;

    const widenPushWindow = (from?: Date | null, to?: Date | null) => {
      if (from && (!pushMinDate || from < pushMinDate)) pushMinDate = from;
      if (to && (!pushMaxDate || to > pushMaxDate)) pushMaxDate = to;
    };

    for (const item of queue) {
      const rid = String(item.reservationId ?? item.id ?? '').trim();
      if (!rid) continue;

      const existing = await this.bookingRepo.findOne({ where: { zodomusReservationId: rid } });

      // status=3 (cancelled) — cancel immediately without GET /reservations
      if (this.queueItemIsCancelled(item)) {
        try {
          const cancelled = await this.cancelBookingByReservationId(rid);
          if (cancelled) {
            widenPushWindow(cancelled.checkIn, cancelled.checkOut);
            processed += 1;
          } else {
            skipped += 1;
          }
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
          widenPushWindow(existing?.checkIn, existing?.checkOut);
          widenPushWindow(row.checkIn, row.checkOut);
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
      this.availabilityPush.scheduleAvailabilityPush(
        property.id,
        pushMinDate && pushMaxDate
          ? { dateFromISO: pushMinDate.toISOString(), dateToISO: pushMaxDate.toISOString() }
          : undefined,
      );
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
    clearOverbookingFlag(row);
    await this.bookingRepo.save(row);
    this.logger.log(`Cancelled booking ${row.id} (zodomusReservationId=${rid})`);
    return row;
  }

  /**
   * Detect another blocking booking that overlaps the inbound stay.
   * OTA bookings are still saved; conflict is flagged for the manager (source of truth = channel).
   */
  private async findInboundOverlap(
    propertyId: string,
    checkIn: Date,
    checkOut: Date,
    excludeBookingId?: string,
  ): Promise<BookingEntity | null> {
    const qb = this.bookingRepo
      .createQueryBuilder('b')
      .where('b.propertyId = :propertyId', { propertyId })
      .andWhere('b.status IN (:...blocking)', {
        blocking: [...BOOKING_STATUSES_BLOCKING_AVAILABILITY],
      })
      .andWhere('b.checkIn < :checkOut', { checkOut })
      .andWhere('b.checkOut > :checkIn', { checkIn });
    if (excludeBookingId) {
      qb.andWhere('b.id != :excludeId', { excludeId: excludeBookingId });
    }
    return qb.getOne();
  }

  private applyOverbookingFlag(row: BookingEntity, conflictWith: BookingEntity | null): void {
    markOverbooking(row, conflictWith);
    if (conflictWith) {
      this.logger.warn(
        `Overbooking: OTA reservation ${row.zodomusReservationId} overlaps booking ${conflictWith.id} (${conflictWith.guestName}) on property ${row.propertyId}`,
      );
    }
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

    let checkIn = parseZodomusDate(raw.checkIn, property.timezone);
    let checkOut = parseZodomusDate(raw.checkOut, property.timezone);
    if (!checkIn) checkIn = new Date();
    if (!checkOut) checkOut = addDays(checkIn, 1);
    if (checkOut.getTime() <= checkIn.getTime()) checkOut = addDays(checkIn, 1);

    const resolvedMajor = Number(raw.totalPrice ?? 0);
    const totalMinor = Math.round((Number.isFinite(resolvedMajor) ? resolvedMajor : 0) * 100);
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

    // Booking.com guest proxy aliases are used for inbound email routing.
    const aliasRaw =
      raw.guestEmailAlias ??
      (raw as Record<string, unknown>).guest_email_alias ??
      (typeof raw.guestEmail === 'string' && raw.guestEmail.toLowerCase().includes('guest.booking.com')
        ? raw.guestEmail
        : undefined);
    if (aliasRaw != null) {
      const alias = String(aliasRaw).trim().toLowerCase();
      row.guestEmailAlias = alias.length > 0 ? alias.slice(0, 255) : null;
    }

    if (row.guestEmail?.trim() || row.guestPhone?.trim()) {
      try {
        const guest = await this.guestService.resolveOrCreate(
          property.ownerId,
          guestName,
          row.guestPhone,
          row.guestEmail,
        );
        row.guestId = guest.id;
      } catch (e) {
        this.logger.debug(`Zodomus upsert: guest CRM skip for ${rid}: ${String(e)}`);
      }
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
    /**
     * Prefer resolved Zodomus total when > 0. Do not wipe an existing CRM total with 0
     * (Booking.com often sends reservation.totalPrice="0" until rooms[] are resolved).
     */
    if (Number.isFinite(totalMinor) && totalMinor > 0) {
      row.totalPriceMinor = totalMinor;
    } else if (!existing || !(Number(existing.totalPriceMinor) > 0)) {
      row.totalPriceMinor = Number.isFinite(totalMinor) ? totalMinor : 0;
    }
    row.currency = currency;
    row.zodomusReservationId = rid;
    row.zodomusChannelId = channelId;
    row.zodomusSynced = false;
    row.status = mapZodomusReservationStatus(raw.status);

    const hint = typeof raw.otaPaymentHint === 'string' ? raw.otaPaymentHint.trim().slice(0, 512) : '';
    row.otaPaymentHint = hint.length > 0 ? hint : null;

    if (row.status === BOOKING_STATUS.CANCELLED || row.status === BOOKING_STATUS.DECLINED) {
      this.applyOverbookingFlag(row, null);
    } else {
      const conflict = await this.findInboundOverlap(property.id, checkIn, checkOut, existing?.id);
      this.applyOverbookingFlag(row, conflict);
    }

    await this.bookingRepo.save(row);

    this.logger.debug(
      `Zodomus upsert reservationId=${rid}: email=${Boolean(row.guestEmail?.trim())} phone=${Boolean(row.guestPhone?.trim())} guestsCount=${row.guestsCount ?? '—'} adults=${row.guestsAdults ?? '—'} children=${row.guestsChildren ?? '—'} overbooking=${row.overbookingConflict}`,
    );
  }
}

function parseZodomusDate(raw: unknown, propertyTimezone: string): Date | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return isValid(raw) ? raw : null;
  const s = String(raw).trim();
  // Pure calendar day from OTA → noon in property TZ (stable round-trip on calendar).
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return calendarDayToInstantInTimezone(s, propertyTimezone);
  }
  // Date-only with time omitted variants like 2026-08-29T00:00:00 or 2026-08-29 00:00:00
  const dayOnly = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s]00:00:00(?:\.0+)?(?:Z)?)?$/);
  if (dayOnly?.[1]) {
    return calendarDayToInstantInTimezone(dayOnly[1], propertyTimezone);
  }
  const d = parseISO(s);
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
