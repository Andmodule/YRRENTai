import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BookingEntity } from '../../booking/entities/booking.entity';
import { PropertyEntity } from '../../property/entities/property.entity';
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
   */
  async syncQueueForProperty(
    ownerUserId: string,
    internalPropertyId: string,
    channelId: number,
  ): Promise<{ processed: number; skipped: number }> {
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

    for (const item of queue) {
      const rid = item.reservationId;
      if (!rid) continue;

      const existing = await this.bookingRepo.findOne({ where: { zodomusReservationId: rid } });
      if (existing?.zodomusSynced) {
        skipped += 1;
        continue;
      }

      const reservation = await this.zodomus.getReservation(channelId, rid);
      await this.upsertBookingFromReservation(property, channelId, reservation, existing);

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
    }

    return { processed, skipped };
  }

  private async upsertBookingFromReservation(
    property: PropertyEntity,
    channelId: number,
    raw: ZodomusReservation,
    existing: BookingEntity | null,
  ): Promise<void> {
    const guestName =
      [raw.guestFirstName, raw.guestLastName].filter(Boolean).join(' ').trim() ||
      raw.guestName ||
      'Guest';
    const checkIn = raw.checkIn ? new Date(raw.checkIn) : new Date();
    const checkOut = raw.checkOut ? new Date(raw.checkOut) : new Date();
    const rid = String(raw.reservationId ?? '');
    const totalMinor = Math.round(Number(raw.totalPrice ?? 0));
    const currency = String(raw.currency || property.currency || 'USD').slice(0, 3);

    const row =
      existing ??
      this.bookingRepo.create({
        propertyId: property.id,
        createdBy: property.ownerId,
        status: 'PENDING',
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
    row.zodomusReservationId = rid || row.zodomusReservationId;
    row.zodomusChannelId = channelId;
    row.zodomusSynced = false;

    await this.bookingRepo.save(row);
  }
}
