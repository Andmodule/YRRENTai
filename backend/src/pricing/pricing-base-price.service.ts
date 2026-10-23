import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, QueryFailedError, Repository } from 'typeorm';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { PropertyService } from '../property/property.service';
import type { PropertyEntity } from '../property/entities/property.entity';
import { CalendarDatesService, type CalendarDatesJob, type CalendarDatesPreview } from '../calendar-dates/calendar-dates.service';
import { PricingConfig } from './pricing-config';
import { PricingService } from './pricing.service';
import { PromotionSyncService } from './promotion-sync.service';
import { channelTargets } from './base-price.util';
import { addDaysYmd, isYmd, nightsCount, toMinor } from './pricing-math.util';
import { PropertyBasePriceEntity } from './entities/property-base-price.entity';
import { PropertyChannelPricingEntity } from './entities/property-channel-pricing.entity';
import { PropertyChannelNightPriceEntity } from './entities/property-channel-night-price.entity';
import { GUEST_PRICE_CHANNELS, type GuestPriceChannel } from './entities/property-channel-profile.entity';
import type { BasePriceNightsDto, BasePriceRangeDto, BookingSendDto, ChannelPricingDto } from './dto/pricing-base-price.dto';

/** Longest range read, set or sent at once (a year, like the availability horizon). */
export const BASE_PRICE_MAX_RANGE_DAYS = 366;

export type ChannelPricingView = {
  channel: GuestPriceChannel;
  markupPct: number;
  singleGuestPct: number | null;
  extraGuestPct: number | null;
  /** Nothing saved yet: markup 0. */
  isDefault: boolean;
};

/** Why «Отправить в Booking» is not available; null = it is. */
export type BookingSendBlock = 'DATES_OFF' | 'DRY_RUN' | 'NOT_ON_BOOKING' | 'NOT_IN_PILOT' | null;

export type BasePriceOverview = {
  /** yyyy-MM-dd → base price, inside [from, to]. */
  base: Record<string, number>;
  channels: Record<GuestPriceChannel, ChannelPricingView>;
  bookingSend: BookingSendBlock;
};

function defaultChannel(channel: GuestPriceChannel): ChannelPricingView {
  return { channel, markupPct: 0, singleGuestPct: null, extraGuestPct: null, isDefault: true };
}

function channelView(row: PropertyChannelPricingEntity): ChannelPricingView {
  return {
    channel: row.channel,
    markupPct: row.markupPct,
    singleGuestPct: row.singleGuestPct,
    extraGuestPct: row.extraGuestPct,
    isDefault: false,
  };
}

/**
 * «Цены → базовая цена»: the property's own nightly price (RentAI is the source of truth), how each
 * channel's price is made from it, and «Отправить в Booking». Sending goes through the «Открыть / закрыть
 * даты» runs (same guards: bookings, sold nights, minimum price, horizon, queue, read-back) and only for a
 * property in the pilot list with ZODOMUS_PROMOTIONS_DRY_RUN=false. Nothing is ever sent by itself.
 * Everything answers 503 until ZODOMUS_PROMOTIONS_BASE_PRICE_ENABLED=true.
 */
@Injectable()
export class PricingBasePriceService {
  constructor(
    private readonly cfg: PricingConfig,
    private readonly pricing: PricingService,
    private readonly sync: PromotionSyncService,
    private readonly propertyService: PropertyService,
    private readonly dates: CalendarDatesService,
    private readonly dataSource: DataSource,
    @InjectRepository(PropertyBasePriceEntity)
    private readonly baseRepo: Repository<PropertyBasePriceEntity>,
    @InjectRepository(PropertyChannelPricingEntity)
    private readonly channelRepo: Repository<PropertyChannelPricingEntity>,
    @InjectRepository(PropertyChannelNightPriceEntity)
    private readonly nightPriceRepo: Repository<PropertyChannelNightPriceEntity>,
  ) {}

  private assertOn(): void {
    this.pricing.assertEnabled();
    if (!this.cfg.flags.basePrice) {
      throw new ServiceUnavailableException('Базовая цена выключена (ZODOMUS_PROMOTIONS_BASE_PRICE_ENABLED=false)');
    }
  }

  /** The flag was switched on before the migration: say so instead of a bare 500. */
  private async tables<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      if (e instanceof QueryFailedError && (e as { driverError?: { code?: string } }).driverError?.code === '42P01') {
        throw new ServiceUnavailableException(
          'Таблицы базовой цены не созданы: запустите миграцию 1778700000000-pricing-base-price',
        );
      }
      throw e;
    }
  }

  /** Throws 404 when the property is not the user's. */
  private owned(user: JwtPayload, propertyId: string): Promise<PropertyEntity> {
    return this.propertyService.findOneForUser(propertyId, user.sub, user.role);
  }

  private assertRange(from: string, to: string): void {
    if (!isYmd(from) || !isYmd(to)) throw new BadRequestException('from / to: yyyy-MM-dd');
    if (from > to) throw new BadRequestException('from позже to');
    if (nightsCount(from, to) > BASE_PRICE_MAX_RANGE_DAYS) {
      throw new BadRequestException(`Не больше ${BASE_PRICE_MAX_RANGE_DAYS} дней за раз`);
    }
  }

  bookingSendBlock(property: PropertyEntity): BookingSendBlock {
    if (!this.dates.enabled) return 'DATES_OFF';
    const ext = this.sync.externalIdOf(property);
    if (!ext) return 'NOT_ON_BOOKING';
    if (!this.cfg.isInAllowlist(property.id, ext)) return 'NOT_IN_PILOT';
    if (this.cfg.flags.dryRun) return 'DRY_RUN';
    return null;
  }

  async overview(user: JwtPayload, propertyId: string, from: string, to: string): Promise<BasePriceOverview> {
    this.assertOn();
    this.assertRange(from, to);
    const property = await this.owned(user, propertyId);
    return this.tables(async () => {
      const [base, channels] = await Promise.all([
        this.baseRepo.find({ where: { propertyId: property.id, date: Between(from, to) } }),
        this.channelRepo.find({ where: { propertyId: property.id } }),
      ]);
      const byChannel = new Map(channels.map((c) => [c.channel, c]));
      return {
        base: Object.fromEntries(base.map((b) => [b.date, b.priceMinor / 100])),
        channels: {
          booking: byChannel.has('booking') ? channelView(byChannel.get('booking')!) : defaultChannel('booking'),
          airbnb: byChannel.has('airbnb') ? channelView(byChannel.get('airbnb')!) : defaultChannel('airbnb'),
        },
        bookingSend: this.bookingSendBlock(property),
      };
    });
  }

  /** Sets (or, with price null, removes) the base price of every night in [from, to]. */
  async setRange(user: JwtPayload, propertyId: string, dto: BasePriceRangeDto): Promise<Record<string, number>> {
    this.assertOn();
    this.assertRange(dto.from, dto.to);
    const property = await this.owned(user, propertyId);
    const dates: string[] = [];
    for (let d = dto.from; d <= dto.to; d = addDaysYmd(d, 1)) dates.push(d);
    return this.tables(async () => {
      await this.dataSource.transaction(async (m) => {
        const repo = m.getRepository(PropertyBasePriceEntity);
        await repo.delete({ propertyId: property.id, date: Between(dto.from, dto.to) });
        if (dto.price != null) {
          const priceMinor = toMinor(dto.price);
          await repo.insert(dates.map((date) => ({ propertyId: property.id, date, priceMinor })));
        }
      });
      const out: Record<string, number> = {};
      if (dto.price != null) for (const d of dates) out[d] = dto.price;
      return out;
    });
  }

  /** Sets base prices night by night (e.g. «Заполнить из Booking»), other nights untouched. */
  async setNights(user: JwtPayload, propertyId: string, dto: BasePriceNightsDto): Promise<Record<string, number>> {
    this.assertOn();
    const property = await this.owned(user, propertyId);
    const rows = Object.entries(dto.prices)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, price]) => ({ propertyId: property.id, date, priceMinor: toMinor(price) }));
    return this.tables(async () => {
      await this.baseRepo.upsert(rows, ['propertyId', 'date']);
      return Object.fromEntries(rows.map((r) => [r.date, r.priceMinor / 100]));
    });
  }

  async saveChannel(
    user: JwtPayload,
    propertyId: string,
    channel: string,
    dto: ChannelPricingDto,
  ): Promise<ChannelPricingView> {
    this.assertOn();
    if (!GUEST_PRICE_CHANNELS.includes(channel as GuestPriceChannel)) {
      throw new BadRequestException(`Площадка: ${GUEST_PRICE_CHANNELS.join(' / ')}`);
    }
    const property = await this.owned(user, propertyId);
    const row: Partial<PropertyChannelPricingEntity> & { propertyId: string; channel: GuestPriceChannel } = {
      propertyId: property.id,
      channel: channel as GuestPriceChannel,
    };
    if (dto.markupPct !== undefined) row.markupPct = dto.markupPct;
    if (dto.singleGuestPct !== undefined) row.singleGuestPct = dto.singleGuestPct;
    if (dto.extraGuestPct !== undefined) row.extraGuestPct = dto.extraGuestPct;
    return this.tables(async () => {
      await this.channelRepo.upsert(row, ['propertyId', 'channel']);
      const saved = await this.channelRepo.findOne({ where: { propertyId: property.id, channel: row.channel } });
      return saved ? channelView(saved) : defaultChannel(row.channel);
    });
  }

  /** Booking price of each night of [from, to]: typed for the night, else base × Booking markup. */
  private async bookingTargets(propertyId: string, from: string, to: string): Promise<Map<string, number>> {
    const [base, typed, rule] = await Promise.all([
      this.baseRepo.find({ where: { propertyId, date: Between(from, to) } }),
      this.nightPriceRepo.find({ where: { propertyId, channel: 'booking', date: Between(from, to) } }),
      this.channelRepo.findOne({ where: { propertyId, channel: 'booking' } }),
    ]);
    const dates: string[] = [];
    for (let d = from; d <= to; d = addDaysYmd(d, 1)) dates.push(d);
    return channelTargets(
      dates,
      Object.fromEntries(base.map((b) => [b.date, b.priceMinor / 100])),
      Object.fromEntries(typed.map((t) => [t.date, t.priceMinor / 100])),
      rule?.markupPct ?? 0,
    );
  }

  /** What «Отправить в Booking» would change for [from, to]. Reads Booking, writes nothing. */
  async previewBooking(user: JwtPayload, propertyId: string, dto: BookingSendDto): Promise<CalendarDatesPreview> {
    this.assertOn();
    this.assertRange(dto.from, dto.to);
    const property = await this.owned(user, propertyId);
    const targets = await this.tables(() => this.bookingTargets(property.id, dto.from, dto.to));
    if (targets.size === 0) throw new BadRequestException('На эти ночи нет базовой цены');
    return this.dates.previewPrices(user, property.id, targets);
  }

  /** Sends the Booking prices of [from, to] — only on the person's command, only for the pilot. */
  async sendBooking(user: JwtPayload, propertyId: string, dto: BookingSendDto): Promise<CalendarDatesJob> {
    this.assertOn();
    this.assertRange(dto.from, dto.to);
    const property = await this.owned(user, propertyId);
    const block = this.bookingSendBlock(property);
    if (block) {
      const why: Record<Exclude<BookingSendBlock, null>, string> = {
        DATES_OFF: 'Отправка на Booking выключена (ZODOMUS_CALENDAR_DATES_ENABLED=false)',
        DRY_RUN: 'Цены в Booking сейчас не отправляются: включён тестовый режим (ZODOMUS_PROMOTIONS_DRY_RUN)',
        NOT_ON_BOOKING: 'Объект не подключён к Booking',
        NOT_IN_PILOT: 'Объект не в списке пилота — цены в Booking для него не отправляются',
      };
      throw new BadRequestException(why[block]);
    }
    const targets = await this.tables(() => this.bookingTargets(property.id, dto.from, dto.to));
    if (targets.size === 0) throw new BadRequestException('На эти ночи нет базовой цены');
    return this.dates.startPrices(user, property.id, targets);
  }
}
