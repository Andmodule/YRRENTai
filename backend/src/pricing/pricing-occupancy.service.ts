import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { BookingEntity } from '../booking/entities/booking.entity';
import { PricingConfig } from './pricing-config';
import { PricingService } from './pricing.service';
import { addDaysYmd, intersectRanges, todayInTz } from './pricing-math.util';
import { isTargetingRateType } from './pricing-targeting.util';
import {
  DEFAULT_OCCUPANCY_SETTINGS,
  FREE_BOOKING_STATUSES,
  bookedNights,
  occupancyPct,
  sortTiers,
  suggestTier,
  ymdInTz,
  type OccupancySettings,
} from './pricing-occupancy.util';
import { PricePromotionEntity } from './entities/price-promotion.entity';
import { PricingOccupancySettingsEntity } from './entities/pricing-occupancy-settings.entity';
import type { OccupancySettingsDto } from './dto/pricing-occupancy.dto';

/** Bookings are stored as an instant near noon of the property day; widen the query like the calendar does. */
const TZ_SLACK_MS = 14 * 60 * 60 * 1000;

export type OccupancyRow = {
  propertyId: string;
  name: string;
  /** Inclusive yyyy-MM-dd window that was counted (today in the property time zone + horizon). */
  from: string;
  to: string;
  totalNights: number;
  bookedNights: number;
  occupancyPct: number;
  /** null = full enough, no discount suggested. */
  suggestedPct: number | null;
  /** Largest seasonal discount already on (or on its way to) Booking inside the window. */
  current: {
    promotionId: string;
    name: string;
    discountPct: number;
    source: PricePromotionEntity['source'];
  } | null;
  /** Why a suggested discount cannot be applied from here. */
  blocked: 'NOT_IN_PILOT' | 'NO_ACCESS' | null;
};

export type OccupancyOverview = {
  settings: OccupancySettings & { isDefault: boolean };
  properties: OccupancyRow[];
  /** Properties that are not on Booking — a Booking discount cannot be suggested for them. */
  notOnBooking: number;
};

/**
 * «Цены → Заполненность»: counts booked nights per property for the coming days and suggests a discount
 * by the tenant's own thresholds. It never writes to Booking: «Применить» in the UI creates an ordinary
 * discount through PricingService (pilot list, minimum price, queue and status are the same).
 * Everything here answers 503 until ZODOMUS_PROMOTIONS_OCCUPANCY_ENABLED=true.
 */
@Injectable()
export class PricingOccupancyService {
  constructor(
    private readonly cfg: PricingConfig,
    private readonly pricing: PricingService,
    @InjectRepository(PricingOccupancySettingsEntity)
    private readonly settingsRepo: Repository<PricingOccupancySettingsEntity>,
    @InjectRepository(BookingEntity)
    private readonly bookingRepo: Repository<BookingEntity>,
    @InjectRepository(PricePromotionEntity)
    private readonly promotionRepo: Repository<PricePromotionEntity>,
  ) {}

  private assertOn(): void {
    this.pricing.assertEnabled();
    if (!this.cfg.flags.occupancy) {
      throw new ServiceUnavailableException(
        'Скидки по заполненности выключены (ZODOMUS_PROMOTIONS_OCCUPANCY_ENABLED=false)',
      );
    }
  }

  private async settingsOf(ownerId: string): Promise<OccupancyOverview['settings']> {
    const row = await this.settingsRepo.findOne({ where: { ownerId } });
    if (!row) {
      return {
        horizonDays: DEFAULT_OCCUPANCY_SETTINGS.horizonDays,
        tiers: sortTiers(DEFAULT_OCCUPANCY_SETTINGS.tiers),
        isDefault: true,
      };
    }
    return { horizonDays: row.horizonDays, tiers: sortTiers(row.tiers), isDefault: false };
  }

  async saveSettings(user: JwtPayload, dto: OccupancySettingsDto): Promise<OccupancyOverview> {
    this.assertOn();
    const { ownerId } = await this.pricing.actor(user);
    await this.settingsRepo.upsert(
      { ownerId, horizonDays: dto.horizonDays, tiers: sortTiers(dto.tiers) },
      ['ownerId'],
    );
    return this.overview(user);
  }

  async overview(user: JwtPayload): Promise<OccupancyOverview> {
    this.assertOn();
    const { ownerId } = await this.pricing.actor(user);
    const settings = await this.settingsOf(ownerId);
    const all = await this.pricing.listProperties(user);
    const rows = all.filter((r) => r.bookingConnected);
    if (rows.length === 0) {
      return { settings, properties: [], notOnBooking: all.length };
    }

    const windows = new Map(
      rows.map((r) => {
        const from = todayInTz(r.timezone);
        return [r.id, { from, to: addDaysYmd(from, settings.horizonDays - 1) }] as const;
      }),
    );
    const firstDay = [...windows.values()].map((w) => w.from).sort()[0]!;
    const lastDay = [...windows.values()].map((w) => w.to).sort().at(-1)!;

    const bookings = await this.bookingRepo
      .createQueryBuilder('b')
      .select(['b.id', 'b.propertyId', 'b.checkIn', 'b.checkOut', 'b.status'])
      .where('b.propertyId IN (:...ids)', { ids: rows.map((r) => r.id) })
      .andWhere('b.checkIn < :end', {
        end: new Date(Date.parse(`${addDaysYmd(lastDay, 1)}T00:00:00.000Z`) + TZ_SLACK_MS),
      })
      .andWhere('b.checkOut > :start', {
        start: new Date(Date.parse(`${firstDay}T00:00:00.000Z`) - TZ_SLACK_MS),
      })
      .andWhere('b.status NOT IN (:...free)', { free: [...FREE_BOOKING_STATUSES] })
      .getMany();

    const tzById = new Map(rows.map((r) => [r.id, r.timezone]));
    const staysById = new Map<string, Array<{ checkIn: string; checkOut: string }>>();
    for (const b of bookings) {
      const tz = tzById.get(b.propertyId);
      const list = staysById.get(b.propertyId) ?? [];
      list.push({ checkIn: ymdInTz(b.checkIn, tz), checkOut: ymdInTz(b.checkOut, tz) });
      staysById.set(b.propertyId, list);
    }

    const promos = await this.promotionRepo.find({
      where: { ownerId, status: 'active' },
      relations: ['targets'],
    });

    const properties = rows.map((r): OccupancyRow => {
      const w = windows.get(r.id)!;
      const booked = bookedNights(staysById.get(r.id) ?? [], w.from, settings.horizonDays);
      const tier = suggestTier(settings.tiers, booked, settings.horizonDays);
      return {
        propertyId: r.id,
        name: r.name,
        from: w.from,
        to: w.to,
        totalNights: settings.horizonDays,
        bookedNights: booked,
        occupancyPct: occupancyPct(booked, settings.horizonDays),
        suggestedPct: tier?.discountPct ?? null,
        current: this.currentDiscount(promos, r.id, w),
        blocked:
          r.promotionsAccess === 'denied' ? 'NO_ACCESS' : r.inPilot ? null : 'NOT_IN_PILOT',
      };
    });

    return { settings, properties, notOnBooking: all.length - rows.length };
  }

  /**
   * The seasonal discount a new one would compete with: Booking shows only the largest deal of the
   * category. Last-minute steps (they depend on the time left to arrival) and Mobile / Country rates
   * (another category, they stack) are not it.
   */
  private currentDiscount(
    promos: PricePromotionEntity[],
    propertyId: string,
    window: { from: string; to: string },
  ): OccupancyRow['current'] {
    let best: OccupancyRow['current'] = null;
    for (const p of promos) {
      if (!p.stayFrom || !p.stayTo || !(p.discountPct > 0)) continue;
      if (p.promotionType === 'last_minute' || isTargetingRateType(p.promotionType)) continue;
      if (!intersectRanges(window, { from: p.stayFrom, to: p.stayTo })) continue;
      const live = (p.targets ?? []).some(
        (t) =>
          t.propertyId === propertyId &&
          t.desiredState === 'on' &&
          (t.state === 'on' || t.state === 'pending'),
      );
      if (!live) continue;
      if (!best || p.discountPct > best.discountPct) {
        best = { promotionId: p.id, name: p.name, discountPct: p.discountPct, source: p.source };
      }
    }
    return best;
  }
}
