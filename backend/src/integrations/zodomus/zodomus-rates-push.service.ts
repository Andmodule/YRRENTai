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
import { extractZodomusInventoryDays } from './zodomus-inventory.util';
import {
  collectFreeNightKeys,
  mergeNightKeysToRanges,
  rateIdPresentInAvailability,
  type RatesDateRange,
} from './zodomus-rates-segments.util';
import {
  extractCurrencyFromZodomusPayload,
  resolveOtaChannelCurrency,
} from './zodomus-reservation-price.util';

export type PushRatesSegmentResult = RatesDateRange & {
  ok: boolean;
  detail?: string;
};

export type PushRatesTargetResult = {
  channelId: number;
  externalListingId: string;
  roomId: string;
  rateId: string;
  ok: boolean;
  detail?: string;
  segments?: PushRatesSegmentResult[];
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

    let targets = this.buildPushTargets(property);
    if (input.channelId != null) {
      targets = targets.filter((t) => t.channelId === input.channelId);
    }
    if (targets.length === 0) {
      throw new BadRequestException(
        'Property has no Zodomus / OTA listing — save external listing id first',
      );
    }

    const allowed = new Set(['PLN', 'EUR', 'USD', 'RUB']);
    /**
     * Booking Maximum/Single: for single rooms only send `prices.price`.
     * Never mirror `price` into `priceSingle` — Zodomus rejects that with
     * "price single room is only available in maximum".
     */
    const priceSingle =
      input.priceSingle != null && Number.isFinite(input.priceSingle) && input.priceSingle > 0
        ? input.priceSingle
        : undefined;

    const crmBlocked = await this.collectCrmBlockedNightKeys(property, dateFrom, dateToExclusive);
    const results: PushRatesTargetResult[] = [];
    /** Filled from first successful ARI fetch — used for all targets. */
    let currencyCode = resolveOtaChannelCurrency({
      explicit: input.currencyCode,
      propertyCurrency: property.currency,
      timezone: property.timezone,
    });

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

        const availRaw = await this.zodomus.getAvailability(
          t.channelId,
          t.extProp,
          dateFrom,
          dateToExclusive,
        );

        currencyCode = resolveOtaChannelCurrency({
          fromAri: extractCurrencyFromZodomusPayload(availRaw),
          explicit: input.currencyCode,
          propertyCurrency: property.currency,
          timezone: property.timezone,
        });
        if (!allowed.has(currencyCode)) {
          currencyCode = 'PLN';
        }

        if (!rateIdPresentInAvailability(availRaw, roomId, rateId)) {
          results.push({
            channelId: t.channelId,
            externalListingId: t.extProp,
            roomId,
            rateId,
            ok: false,
            detail: `rateId ${rateId} not present in GET /availability for room ${roomId} — Channel rooms and rates are not mapped`,
          });
          continue;
        }

        const days = extractZodomusInventoryDays(availRaw, {
          preferRoomId: roomId,
          preferRateId: rateId,
        });
        const freeKeys = collectFreeNightKeys(days, dateFrom, dateToExclusive, crmBlocked);
        const ranges = mergeNightKeysToRanges(freeKeys);

        if (ranges.length === 0) {
          results.push({
            channelId: t.channelId,
            externalListingId: t.extProp,
            roomId,
            rateId,
            ok: false,
            detail: 'No free OTA nights in range (booked!=0, availability=0, closed, or CRM blocked)',
            segments: [],
          });
          continue;
        }

        const segments: PushRatesSegmentResult[] = [];
        for (const range of ranges) {
          try {
            await this.zodomus.setRates({
              channelId: t.channelId,
              propertyId: t.extProp,
              roomId,
              rateId,
              dateFrom: range.dateFrom,
              dateToExclusive: range.dateToExclusive,
              currencyCode,
              price: input.price,
              ...(priceSingle != null ? { priceSingle } : {}),
            });
            segments.push({ ...range, ok: true });
          } catch (e) {
            const detail = formatZodomusHttpException(e);
            this.logger.warn(
              `POST /rates failed property=${property.id} channel=${t.channelId} ${range.dateFrom}→${range.dateToExclusive}: ${detail}`,
            );
            segments.push({ ...range, ok: false, detail });
          }
        }

        const ok = segments.some((s) => s.ok);
        results.push({
          channelId: t.channelId,
          externalListingId: t.extProp,
          roomId,
          rateId,
          ok,
          detail: ok
            ? undefined
            : segments
                .map((s) => s.detail)
                .filter(Boolean)
                .join('; ') || 'All rate segments failed',
          segments,
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
      const details = results.map((r) => r.detail).filter(Boolean);
      const allNoFree = results.every(
        (r) => r.detail?.includes('No free OTA nights') || r.segments?.length === 0,
      );
      if (allNoFree && details.length > 0) {
        throw new BadRequestException(
          `Cannot set OTA price — no free nights in range: ${details.join('; ')}`,
        );
      }
      throw new ServiceUnavailableException(
        `Zodomus rates push failed: ${details.join('; ') || 'unknown'}`,
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
   * CRM nights that already block inventory — skip when pushing rates
   * (do not hard-fail the whole range).
   */
  private async collectCrmBlockedNightKeys(
    property: PropertyEntity,
    dateFrom: string,
    dateToExclusive: string,
  ): Promise<Set<string>> {
    const tz = property.timezone?.trim() || 'UTC';
    const rangeStart = fromZonedTime(`${dateFrom}T12:00:00`, tz);
    const rangeEnd = fromZonedTime(`${dateToExclusive}T12:00:00`, tz);

    const bookings = await this.bookingRepo
      .createQueryBuilder('b')
      .where('b.propertyId = :propertyId', { propertyId: property.id })
      .andWhere('b.status IN (:...blocking)', {
        blocking: [...BOOKING_STATUSES_BLOCKING_AVAILABILITY],
      })
      .andWhere('b.checkIn < :rangeEnd AND b.checkOut > :rangeStart', {
        rangeStart,
        rangeEnd,
      })
      .getMany();

    const blocked = new Set<string>();
    for (const b of bookings) {
      const from = formatInTimeZone(b.checkIn, tz, 'yyyy-MM-dd');
      const to = formatInTimeZone(b.checkOut, tz, 'yyyy-MM-dd');
      let cur = from < dateFrom ? dateFrom : from;
      const end = to > dateToExclusive ? dateToExclusive : to;
      while (cur < end) {
        blocked.add(cur);
        const parts = cur.split('-').map(Number);
        const y = parts[0];
        const m = parts[1];
        const d = parts[2];
        if (y == null || m == null || d == null) break;
        cur = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
        if (blocked.size > 800) break;
      }
    }
    return blocked;
  }
}
