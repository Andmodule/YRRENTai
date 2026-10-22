import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, QueryFailedError, Repository } from 'typeorm';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { PropertyService } from '../property/property.service';
import { PricingConfig } from './pricing-config';
import { PricingService } from './pricing.service';
import { compareWithObserved, guestPriceBreakdown, type GuestPriceInput } from './guest-price.util';
import { addDaysYmd, isYmd, nightsCount, toMajor, toMinor } from './pricing-math.util';
import {
  GUEST_PRICE_CHANNELS,
  PropertyChannelProfileEntity,
  type ExtraDiscount,
  type GuestPriceChannel,
} from './entities/property-channel-profile.entity';
import { PropertyChannelNightPriceEntity } from './entities/property-channel-night-price.entity';
import { PriceObservationEntity, type GuestPriceScenario } from './entities/price-observation.entity';
import type { ChannelProfileDto, NightPricesDto, ObservationDto } from './dto/pricing-guest-price.dto';

/** Longest window the panel asks for / a hand-typed price range may cover. */
export const GUEST_PRICE_MAX_RANGE_DAYS = 120;
/** Observations returned with the overview, newest first. */
const OBSERVATIONS_SHOWN = 10;
/** Totals are stored in minor units in `integer` columns. */
const MAX_TOTAL = 10_000_000;
/** Grosz / cents: a bigger gap between the panel's total and the server's means the two calculations drifted. */
const DRIFT_TOLERANCE = 0.01;

export type ChannelProfileView = {
  channel: GuestPriceChannel;
  cleaningFee: number | null;
  vatIncludedPct: number | null;
  cityTaxPerGuestNight: number | null;
  extraDiscounts: ExtraDiscount[];
  weeklyPct: number | null;
  monthlyPct: number | null;
  nightly: number | null;
  weekendNightly: number | null;
  /** Nothing saved yet for this channel. */
  isDefault: boolean;
};

export type ObservationView = {
  id: string;
  channel: GuestPriceChannel;
  scenario: GuestPriceScenario;
  checkIn: string;
  nights: number;
  guests: number;
  observedTotal: number;
  calculatedTotal: number;
  deltaPct: number;
  withinTolerance: boolean;
  createdAt: string;
};

export type GuestPriceOverview = {
  profiles: Record<GuestPriceChannel, ChannelProfileView>;
  /** Hand-typed nightly prices in [from, to], per channel: yyyy-MM-dd → price. */
  nightPrices: Record<GuestPriceChannel, Record<string, number>>;
  observations: ObservationView[];
};

function emptyProfile(channel: GuestPriceChannel): ChannelProfileView {
  return {
    channel,
    cleaningFee: null,
    vatIncludedPct: null,
    cityTaxPerGuestNight: null,
    extraDiscounts: [],
    weeklyPct: null,
    monthlyPct: null,
    nightly: null,
    weekendNightly: null,
    isDefault: true,
  };
}

function profileView(row: PropertyChannelProfileEntity): ChannelProfileView {
  return {
    channel: row.channel,
    cleaningFee: toMajor(row.cleaningFeeMinor),
    vatIncludedPct: row.vatIncludedPct,
    cityTaxPerGuestNight: toMajor(row.cityTaxPerGuestNightMinor),
    extraDiscounts: row.extraDiscounts ?? [],
    weeklyPct: row.weeklyPct,
    monthlyPct: row.monthlyPct,
    nightly: toMajor(row.nightlyMinor),
    weekendNightly: toMajor(row.weekendNightlyMinor),
    isDefault: false,
  };
}

export function observationView(row: PriceObservationEntity): ObservationView {
  const observedTotal = row.observedTotalMinor / 100;
  const calculatedTotal = row.calculatedTotalMinor / 100;
  const cmp = compareWithObserved(calculatedTotal, observedTotal);
  return {
    id: row.id,
    channel: row.channel,
    scenario: row.scenario,
    checkIn: row.checkIn,
    nights: row.nights,
    guests: row.guests,
    observedTotal,
    calculatedTotal,
    deltaPct: cmp.deltaPct,
    withinTolerance: cmp.withinTolerance,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A money field of the DTO → minor units; undefined = leave as it is. */
function minorOf(v: number | null | undefined): number | null | undefined {
  return v === undefined ? undefined : v === null ? null : toMinor(v);
}

/**
 * «Цена для гостя»: channel profiles, hand-typed channel prices and calibration observations.
 * Read-only towards the channels — nothing here talks to Booking or Airbnb; the panel prices nights
 * with the rack prices the calendar already has. Everything answers 503 until
 * ZODOMUS_PROMOTIONS_GUEST_PRICE_ENABLED=true.
 */
@Injectable()
export class PricingGuestPriceService {
  private readonly logger = new Logger(PricingGuestPriceService.name);

  constructor(
    private readonly cfg: PricingConfig,
    private readonly pricing: PricingService,
    private readonly propertyService: PropertyService,
    private readonly dataSource: DataSource,
    @InjectRepository(PropertyChannelProfileEntity)
    private readonly profileRepo: Repository<PropertyChannelProfileEntity>,
    @InjectRepository(PropertyChannelNightPriceEntity)
    private readonly nightPriceRepo: Repository<PropertyChannelNightPriceEntity>,
    @InjectRepository(PriceObservationEntity)
    private readonly observationRepo: Repository<PriceObservationEntity>,
  ) {}

  private assertOn(): void {
    this.pricing.assertEnabled();
    if (!this.cfg.flags.guestPrice) {
      throw new ServiceUnavailableException(
        'Цена для гостя выключена (ZODOMUS_PROMOTIONS_GUEST_PRICE_ENABLED=false)',
      );
    }
  }

  /** The flag was switched on before the migration: say so instead of a bare 500. */
  private async tables<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      if (e instanceof QueryFailedError && (e as { driverError?: { code?: string } }).driverError?.code === '42P01') {
        throw new ServiceUnavailableException(
          'Таблицы цены для гостя не созданы: запустите миграцию 1778600000000-pricing-guest-price',
        );
      }
      throw e;
    }
  }

  /** Throws 404 when the property is not the user's. */
  private async ownedPropertyId(user: JwtPayload, propertyId: string): Promise<string> {
    return (await this.propertyService.findOneForUser(propertyId, user.sub, user.role)).id;
  }

  private assertRange(from: string, to: string): void {
    if (!isYmd(from) || !isYmd(to)) throw new BadRequestException('from / to: yyyy-MM-dd');
    if (from > to) throw new BadRequestException('from позже to');
    if (nightsCount(from, to) > GUEST_PRICE_MAX_RANGE_DAYS) {
      throw new BadRequestException(`Не больше ${GUEST_PRICE_MAX_RANGE_DAYS} дней за раз`);
    }
  }

  async overview(user: JwtPayload, propertyId: string, from: string, to: string): Promise<GuestPriceOverview> {
    this.assertOn();
    this.assertRange(from, to);
    const id = await this.ownedPropertyId(user, propertyId);
    return this.tables(() => this.load(id, from, to));
  }

  private async load(propertyId: string, from: string, to: string): Promise<GuestPriceOverview> {
    const [profiles, prices, observations] = await Promise.all([
      this.profileRepo.find({ where: { propertyId } }),
      this.nightPriceRepo.find({ where: { propertyId, date: Between(from, to) } }),
      this.observationRepo.find({ where: { propertyId }, order: { createdAt: 'DESC' }, take: OBSERVATIONS_SHOWN }),
    ]);
    const byChannel = new Map(profiles.map((p) => [p.channel, p]));
    const nightPrices = { booking: {}, airbnb: {} } as GuestPriceOverview['nightPrices'];
    for (const p of prices) nightPrices[p.channel][p.date] = p.priceMinor / 100;
    return {
      profiles: {
        booking: byChannel.has('booking') ? profileView(byChannel.get('booking')!) : emptyProfile('booking'),
        airbnb: byChannel.has('airbnb') ? profileView(byChannel.get('airbnb')!) : emptyProfile('airbnb'),
      },
      nightPrices,
      observations: observations.map(observationView),
    };
  }

  async saveProfile(
    user: JwtPayload,
    propertyId: string,
    channel: string,
    dto: ChannelProfileDto,
  ): Promise<ChannelProfileView> {
    this.assertOn();
    if (!GUEST_PRICE_CHANNELS.includes(channel as GuestPriceChannel)) {
      throw new BadRequestException(`Площадка: ${GUEST_PRICE_CHANNELS.join(' / ')}`);
    }
    const id = await this.ownedPropertyId(user, propertyId);
    const row: Partial<PropertyChannelProfileEntity> & { propertyId: string; channel: GuestPriceChannel } = {
      propertyId: id,
      channel: channel as GuestPriceChannel,
    };
    const set = <K extends keyof PropertyChannelProfileEntity>(k: K, v: PropertyChannelProfileEntity[K] | undefined) => {
      if (v !== undefined) row[k] = v;
    };
    set('cleaningFeeMinor', minorOf(dto.cleaningFee));
    set('vatIncludedPct', dto.vatIncludedPct);
    set('cityTaxPerGuestNightMinor', minorOf(dto.cityTaxPerGuestNight));
    set('extraDiscounts', dto.extraDiscounts === undefined ? undefined : dto.extraDiscounts?.length ? dto.extraDiscounts : null);
    set('weeklyPct', dto.weeklyPct);
    set('monthlyPct', dto.monthlyPct);
    set('nightlyMinor', minorOf(dto.nightly));
    set('weekendNightlyMinor', minorOf(dto.weekendNightly));
    return this.tables(async () => {
      await this.profileRepo.upsert(row, ['propertyId', 'channel']);
      const saved = await this.profileRepo.findOne({ where: { propertyId: id, channel: row.channel } });
      return saved ? profileView(saved) : emptyProfile(row.channel);
    });
  }

  /** Sets (or, with price null, removes) a channel's own price for every night in [from, to]. */
  async setNightPrices(
    user: JwtPayload,
    propertyId: string,
    dto: NightPricesDto,
  ): Promise<Record<string, number>> {
    this.assertOn();
    this.assertRange(dto.from, dto.to);
    const id = await this.ownedPropertyId(user, propertyId);
    const dates: string[] = [];
    for (let d = dto.from; d <= dto.to; d = addDaysYmd(d, 1)) dates.push(d);
    return this.tables(async () => {
      await this.dataSource.transaction(async (m) => {
        const repo = m.getRepository(PropertyChannelNightPriceEntity);
        await repo.delete({ propertyId: id, channel: dto.channel, date: Between(dto.from, dto.to) });
        if (dto.price != null) {
          const priceMinor = toMinor(dto.price);
          await repo.insert(dates.map((date) => ({ propertyId: id, channel: dto.channel, date, priceMinor })));
        }
      });
      const out: Record<string, number> = {};
      if (dto.price != null) for (const d of dates) out[d] = dto.price;
      return out;
    });
  }

  async addObservation(user: JwtPayload, propertyId: string, dto: ObservationDto): Promise<ObservationView> {
    this.assertOn();
    const id = await this.ownedPropertyId(user, propertyId);
    const input = dto.input as GuestPriceInput;
    const sorted = [...input.nights].map((n) => n.date).sort();
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== addDaysYmd(sorted[i - 1]!, 1)) {
        throw new BadRequestException('Ночи должны идти подряд, без повторов');
      }
    }
    const calculated = guestPriceBreakdown(input).total;
    if (calculated > MAX_TOTAL || dto.observedTotal > MAX_TOTAL) {
      throw new BadRequestException(`Итог больше ${MAX_TOTAL.toLocaleString('ru-RU')} — проверьте цифры`);
    }
    if (Math.abs(calculated - dto.clientTotal) > DRIFT_TOLERANCE) {
      // Not the guest's problem — the panel and the server price differently. Keep the server's number.
      this.logger.warn(
        `guest price drift property=${id} channel=${dto.channel}: panel ${dto.clientTotal} vs server ${calculated}`,
      );
    }
    return this.tables(async () => {
      const row = await this.observationRepo.save(
        this.observationRepo.create({
          propertyId: id,
          channel: dto.channel,
          scenario: dto.scenario,
          checkIn: sorted[0]!,
          nights: sorted.length,
          guests: dto.guests,
          observedTotalMinor: toMinor(dto.observedTotal),
          calculatedTotalMinor: toMinor(calculated),
          input,
          createdByUserId: user.sub,
        }),
      );
      return observationView(row);
    });
  }
}
