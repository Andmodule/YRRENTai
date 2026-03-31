import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { addDays, isValid, parseISO } from 'date-fns';
import { BOOKING_STATUS } from '@rentai/shared';
import { BookingEntity } from '../../booking/entities/booking.entity';
import type { PropertyEntity } from '../../property/entities/property.entity';
import { PropertyService } from '../../property/property.service';
import { ZodomusService } from './zodomus.service';
import type { ZodomusReservation } from './zodomus.types';

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
   * Pull reservation queue for one property (must have `zodomusPropertyId`), upsert bookings, ACK.
   * @param force — заново GET /reservations и upsert даже если бронь уже помечена `zodomusSynced` (после смены маппинга / исправления дат).
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
      if (!force && existing?.zodomusSynced) {
        skipped += 1;
        continue;
      }

      try {
        const reservation = await this.zodomus.getReservation(channelId, rid, extId);
        await this.upsertBooking(property, channelId, reservation, existing, rid);

        try {
          await this.zodomus.ackReservation(channelId, rid);
        } catch (e) {
          this.logger.warn(`Zodomus ACK failed for ${rid}: ${String(e)}`);
        }

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

  /**
   * Подтянуть очередь для всех объектов владельца с заданным `zodomusPropertyId`.
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
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let propertiesTouched = 0;
    for (const p of list) {
      if (!p.zodomusPropertyId?.trim()) continue;
      propertiesTouched += 1;
      const r = await this.syncQueueForProperty(ownerUserId, p.id, channelId, force);
      processed += r.processed;
      skipped += r.skipped;
      failed += r.failed;
    }
    return { processed, skipped, failed, propertiesTouched };
  }

  private async upsertBooking(
    property: PropertyEntity,
    channelId: number,
    raw: ZodomusReservation,
    existing: BookingEntity | null,
    /** Id from queue / GET param — used if API body omits reservationId/id. */
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

    // Zodomus обычно отдаёт сумму в основных единицах валюты; в БД — минорные (как в календаре /100).
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
    row.status = mapZodomusStatusToBookingStatus(raw.status);

    await this.bookingRepo.save(row);
  }
}

function parseZodomusDate(raw: unknown): Date | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return isValid(raw) ? raw : null;
  const d = parseISO(String(raw).trim());
  return isValid(d) ? d : null;
}

function mapZodomusStatusToBookingStatus(raw: unknown): string {
  const s = String(raw ?? '')
    .toLowerCase()
    .trim();
  if (!s) return BOOKING_STATUS.PENDING;
  if (s.includes('cancel')) return BOOKING_STATUS.CANCELLED;
  if (s.includes('declin')) return BOOKING_STATUS.DECLINED;
  if (s.includes('confirm') || s.includes('ok') || s.includes('book')) return BOOKING_STATUS.CONFIRMED;
  return BOOKING_STATUS.PENDING;
}
