import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { BOOKING_STATUSES_BLOCKING_AVAILABILITY } from '@rentai/shared';
import { PropertyEntity } from '../../property/entities/property.entity';
import { BookingEntity } from '../../booking/entities/booking.entity';
import { ZodomusService } from './zodomus.service';
import { pickPrimaryRateId } from './zodomus-room-rates.util';
import { formatZodomusHttpException } from './zodomus-status.util';

export type PushRatesTargetResult = {
  channelId: number;
  externalListingId: string;
  roomId: string;
  rateId: string;
  ok: boolean;
  detail?: string;
};

export type PushRatesResult = {
  propertyId: string;
  dateFrom: string;
  dateToExclusive: string;
  price: number;
  currencyCode: string;
  targets: PushRatesTargetResult[];
};

type PushTarget = { channelId: number; extProp: string; storedRoomId: string | null };

@Injectable()
export class ZodomusRatesPushService {
  private readonly logger = new Logger(ZodomusRatesPushService.name);

  constructor(
    private readonly zodomus: ZodomusService,
    @InjectRepository(PropertyEntity)
    private readonly propertyRepo: Repository<PropertyEntity>,
    @InjectRepository(BookingEntity)
    private readonly bookingRepo: Repository<BookingEntity>,
  ) {}

  async pushRatesForProperty(input: {
    propertyId: string;
    dateFrom: string;
    dateToExclusive: string;
    price: number;
    priceSingle?: number;
    currencyCode?: string;
    rateId?: string;
    channelId?: number;
  }): Promise<PushRatesResult> {
    if (!this.zodomus.isEnabled) {
      throw new ServiceUnavailableException('Zodomus is disabled');
    }

    const property = await this.propertyRepo.findOne({
      where: { id: input.propertyId },
      relations: ['otaPlatform', 'channelListings', 'channelListings.otaPlatform'],
    });
    if (!property) {
      throw new NotFoundException(`Property ${input.propertyId} not found`);
    }

    const dateFrom = input.dateFrom.trim();
    const dateToExclusive = input.dateToExclusive.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateToExclusive)) {
      throw new BadRequestException('dateFrom/dateTo must be yyyy-MM-dd');
    }
    if (dateFrom >= dateToExclusive) {
      throw new BadRequestException('dateTo must be after dateFrom');
    }

    await this.assertRangeIsFree(property, dateFrom, dateToExclusive);

    let targets = this.buildPushTargets(property);
    if (input.channelId != null) {
      targets = targets.filter((t) => t.channelId === input.channelId);
    }
    if (targets.length === 0) {
      throw new BadRequestException(
        'Property has no Zodomus / OTA listing — save external listing id first',
      );
    }

    const currencyCode =
      input.currencyCode?.trim().toUpperCase() || property.currency?.trim().toUpperCase() || '';
    if (!/^[A-Z]{3}$/.test(currencyCode)) {
      throw new BadRequestException(
        'currencyCode is required (3-letter ISO) — set it on the request or property.currency',
      );
    }

    /**
     * Booking Maximum/Single: for single rooms only send `prices.price`.
     * Never mirror `price` into `priceSingle` — Zodomus rejects that with
     * "price single room is only available in maximum".
     */
    const priceSingle =
      input.priceSingle != null && Number.isFinite(input.priceSingle) && input.priceSingle > 0
        ? input.priceSingle
        : undefined;

    const results: PushRatesTargetResult[] = [];

    for (const t of targets) {
      try {
        const roomId = await this.resolveRoomId(property, t);
        if (!roomId) {
          results.push({
            channelId: t.channelId,
            externalListingId: t.extProp,
            roomId: '',
            rateId: '',
            ok: false,
            detail: 'Could not resolve roomId from GET /room-rates',
          });
          continue;
        }

        let rateId = input.rateId?.trim() || '';
        if (!rateId) {
          const raw = await this.zodomus.getRoomRatesRaw(t.channelId, t.extProp);
          rateId = pickPrimaryRateId(raw, roomId) ?? '';
        }
        if (!rateId) {
          results.push({
            channelId: t.channelId,
            externalListingId: t.extProp,
            roomId,
            rateId: '',
            ok: false,
            detail: 'Could not resolve rateId from GET /room-rates',
          });
          continue;
        }

        await this.zodomus.setRates({
          channelId: t.channelId,
          propertyId: t.extProp,
          roomId,
          rateId,
          dateFrom,
          dateToExclusive,
          currencyCode,
          price: input.price,
          ...(priceSingle != null ? { priceSingle } : {}),
        });

        results.push({
          channelId: t.channelId,
          externalListingId: t.extProp,
          roomId,
          rateId,
          ok: true,
        });
      } catch (e) {
        const detail = formatZodomusHttpException(e);
        this.logger.warn(
          `POST /rates failed property=${property.id} channel=${t.channelId}: ${detail}`,
        );
        results.push({
          channelId: t.channelId,
          externalListingId: t.extProp,
          roomId: '',
          rateId: '',
          ok: false,
          detail,
        });
      }
    }

    if (!results.some((r) => r.ok)) {
      throw new ServiceUnavailableException(
        `Zodomus rates push failed: ${results.map((r) => r.detail).filter(Boolean).join('; ') || 'unknown'}`,
      );
    }

    return {
      propertyId: property.id,
      dateFrom,
      dateToExclusive,
      price: input.price,
      currencyCode,
      targets: results,
    };
  }

  private buildPushTargets(property: PropertyEntity): PushTarget[] {
    const targets: PushTarget[] = [];
    for (const row of property.channelListings ?? []) {
      const ch = row.otaPlatform?.zodomusChannelId;
      const ext = row.externalListingId?.trim();
      if (ch == null || !ext) continue;
      targets.push({
        channelId: ch,
        extProp: ext,
        storedRoomId: row.zodomusRoomId?.trim() ? row.zodomusRoomId.trim() : null,
      });
    }
    if (targets.length === 0) {
      const leg = property.zodomusPropertyId?.trim();
      const ch = property.otaPlatform?.zodomusChannelId;
      if (leg && ch != null) {
        targets.push({
          channelId: ch,
          extProp: leg,
          storedRoomId: property.zodomusRoomId?.trim() || null,
        });
      }
    }
    return targets;
  }

  private async resolveRoomId(
    property: PropertyEntity,
    target: PushTarget,
  ): Promise<string | null> {
    const ext = target.extProp.trim();
    if (!ext) return null;
    const stored = target.storedRoomId?.trim();
    if (stored && stored !== ext) return stored;
    const raw = await this.zodomus.getRoomRates(target.channelId, ext);
    const list = Array.isArray(raw) ? raw : [];
    if (list.length === 0) return null;
    const first = list[0] as { id?: string | number } | undefined;
    const id = first?.id;
    return id != null && String(id).trim() !== '' ? String(id) : null;
  }

  /**
   * Refuse to push rates over nights that already have a blocking CRM booking
   * (free dates only — user request).
   */
  private async assertRangeIsFree(
    property: PropertyEntity,
    dateFrom: string,
    dateToExclusive: string,
  ): Promise<void> {
    const tz = property.timezone?.trim() || 'UTC';
    const rangeStart = fromZonedTime(`${dateFrom}T12:00:00`, tz);
    const rangeEnd = fromZonedTime(`${dateToExclusive}T12:00:00`, tz);

    const overlap = await this.bookingRepo
      .createQueryBuilder('b')
      .where('b.propertyId = :propertyId', { propertyId: property.id })
      .andWhere('b.status IN (:...blocking)', {
        blocking: [...BOOKING_STATUSES_BLOCKING_AVAILABILITY],
      })
      .andWhere('b.checkIn < :rangeEnd AND b.checkOut > :rangeStart', {
        rangeStart,
        rangeEnd,
      })
      .orderBy('b.checkIn', 'ASC')
      .getOne();

    if (overlap) {
      const from = formatInTimeZone(overlap.checkIn, tz, 'yyyy-MM-dd');
      const to = formatInTimeZone(overlap.checkOut, tz, 'yyyy-MM-dd');
      throw new BadRequestException(
        `Cannot set OTA price on booked dates — overlaps booking ${from}→${to}`,
      );
    }
  }
}
