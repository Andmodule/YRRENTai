import { createHash } from 'crypto';
import { BadRequestException, ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, In, QueryFailedError, Repository } from 'typeorm';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { PropertyService } from '../property/property.service';
import type { PropertyEntity } from '../property/entities/property.entity';
import { CalendarDatesService, type CalendarDatesJob, type CalendarDatesPreview } from '../calendar-dates/calendar-dates.service';
import { PricingConfig } from './pricing-config';
import { PricingService } from './pricing.service';
import { PromotionSyncService } from './promotion-sync.service';
import { channelTargets } from './base-price.util';
import { autoChannelPrice } from './autoprice.util';
import { PropertyAutoPriceEntity } from './entities/pricing-auto-price.entity';
import { addDaysYmd, nightsCount, toMinor, todayInTz } from './pricing-math.util';
// The strict check: «2026-02-30» is refused, not left to the database.
import { isYmd, weekdayOf } from '../calendar-dates/calendar-dates.util';
import { PropertyBasePriceEntity } from './entities/property-base-price.entity';
import { PropertyChannelPricingEntity } from './entities/property-channel-pricing.entity';
import { PropertyChannelNightPriceEntity } from './entities/property-channel-night-price.entity';
import { GUEST_PRICE_CHANNELS, type GuestPriceChannel } from './entities/property-channel-profile.entity';
import type { BasePriceRangeDto, BookingSendConfirmDto, BookingSendDto, ChannelPricingDto } from './dto/pricing-base-price.dto';

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

/** Preview of «Отправить в Booking» + the fingerprint «Отправить» must bring back. */
export type BookingPreview = CalendarDatesPreview & { fingerprint: string };

export type FillFromBookingResult = {
  /** Nights that got Booking's price as their base. */
  filled: number;
  /** Had a base price already — kept. */
  kept: number;
  /** Closed, sold out or without a price on Booking — left without a base. */
  notOpen: number;
};

/** Same targets ↔ same fingerprint (sorted night → price). */
export function targetsFingerprint(targets: ReadonlyMap<string, number>): string {
  const entries = [...targets].sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha1').update(JSON.stringify(entries)).digest('hex');
}

export type BasePriceOverview = {
  /** yyyy-MM-dd → base price, inside [from, to]. */
  base: Record<string, number>;
  channels: Record<GuestPriceChannel, ChannelPricingView>;
  bookingSend: BookingSendBlock;
  /** «Автоцены»: yyyy-MM-dd → signed percent the rule put on the night (empty while the rule is off). */
  auto: Record<string, number>;
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
  private readonly logger = new Logger(PricingBasePriceService.name);

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
    @InjectRepository(PropertyAutoPriceEntity)
    private readonly autoRepo: Repository<PropertyAutoPriceEntity>,
  ) {}

  /**
   * «Автоцены»: adjustments the rule put on nights of [from, to]. Empty while the rule is off; a missing
   * table (flag on before the migration) must not break «Отправить в Booking» — logged and treated as none.
   */
  async autoAdjustments(propertyId: string, from: string, to: string): Promise<Map<string, number>> {
    // «Только показывать» or Booking writes paused: stored adjustments rest, the base price applies.
    if (!this.cfg.flags.autoPrice || this.cfg.flags.autoPriceDryRun || this.cfg.flags.dryRun) return new Map();
    try {
      const rows = await this.autoRepo.find({ where: { propertyId, date: Between(from, to) } });
      return new Map(rows.map((r) => [r.date, r.pct]));
    } catch (e) {
      this.logger.warn(`auto prices unreadable (migration 1778800000000 not run?): ${e instanceof Error ? e.message : String(e)}`);
      return new Map();
    }
  }

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
    // Unlike Booking promotions, an empty pilot list means «nobody»: prices go out only for named properties.
    if (this.cfg.flags.allowlist.size === 0 || !this.cfg.isInAllowlist(property.id, ext)) return 'NOT_IN_PILOT';
    if (this.cfg.flags.dryRun) return 'DRY_RUN';
    return null;
  }

  async overview(user: JwtPayload, propertyId: string, from: string, to: string): Promise<BasePriceOverview> {
    this.assertOn();
    this.assertRange(from, to);
    const property = await this.owned(user, propertyId);
    return this.tables(async () => {
      const [base, channels, auto] = await Promise.all([
        this.baseRepo.find({ where: { propertyId: property.id, date: Between(from, to) } }),
        this.channelRepo.find({ where: { propertyId: property.id } }),
        this.autoAdjustments(property.id, from, to),
      ]);
      const byChannel = new Map(channels.map((c) => [c.channel, c]));
      return {
        base: Object.fromEntries(base.map((b) => [b.date, b.priceMinor / 100])),
        channels: {
          booking: byChannel.has('booking') ? channelView(byChannel.get('booking')!) : defaultChannel('booking'),
          airbnb: byChannel.has('airbnb') ? channelView(byChannel.get('airbnb')!) : defaultChannel('airbnb'),
        },
        bookingSend: this.bookingSendBlock(property),
        auto: Object.fromEntries(auto),
      };
    });
  }

  /** Sets (or, with price null, removes) the base price of every night in [from, to]. */
  async setRange(user: JwtPayload, propertyId: string, dto: BasePriceRangeDto): Promise<Record<string, number>> {
    this.assertOn();
    this.assertRange(dto.from, dto.to);
    const property = await this.owned(user, propertyId);
    const days = dto.weekdays ? new Set(dto.weekdays) : null;
    const dates: string[] = [];
    for (let d = dto.from; d <= dto.to; d = addDaysYmd(d, 1)) if (!days || days.has(weekdayOf(d))) dates.push(d);
    if (dates.length === 0) throw new BadRequestException('В выбранных датах нет этих дней недели');
    return this.tables(async () => {
      await this.dataSource.transaction(async (m) => {
        const repo = m.getRepository(PropertyBasePriceEntity);
        // Days of the week: the other nights of the range keep their price.
        await repo.delete({ propertyId: property.id, date: days ? In(dates) : Between(dto.from, dto.to) });
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

  /**
   * «Заполнить из Booking»: nights of [from, to] from today on that have no base price get the price of
   * Booking's main rate — only nights open for sale (a closed night carries Booking's placeholder price).
   * Reads Booking, writes only RentAI.
   */
  async fillFromBooking(user: JwtPayload, propertyId: string, dto: BookingSendDto): Promise<FillFromBookingResult> {
    this.assertOn();
    this.assertRange(dto.from, dto.to);
    const property = await this.owned(user, propertyId);
    const existing = await this.tables(() => this.baseRepo.find({ where: { propertyId: property.id, date: Between(dto.from, dto.to) } }));
    const has = new Set(existing.map((b) => b.date));
    const open = await this.dates.readOpenRatePrices(user, property.id, dto.from, addDaysYmd(dto.to, 1));
    const rows = [...open]
      .filter(([date]) => !has.has(date))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, price]) => ({ propertyId: property.id, date, priceMinor: toMinor(price) }));
    // ON CONFLICT DO NOTHING: a base price saved while Booking was being read is not overwritten.
    if (rows.length > 0) {
      await this.tables(() =>
        this.baseRepo.createQueryBuilder().insert().into(PropertyBasePriceEntity).values(rows).orIgnore().execute(),
      );
    }
    const kept = [...open.keys()].filter((d) => has.has(d)).length;
    return { filled: rows.length, kept, notOpen: Math.max(0, this.futureNights(property, dto.from, dto.to) - open.size) };
  }

  /** Nights of [from, to] from today (property time zone) on. */
  private futureNights(property: PropertyEntity, from: string, to: string): number {
    const today = todayInTz(property.timezone);
    const start = from < today ? today : from;
    return start > to ? 0 : nightsCount(start, to);
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

  /**
   * Booking price of each night of [from, to]: typed for the night, else base × Booking markup — with the
   * «Автоцены» adjustment of the night when there is one (never below the minimum price).
   */
  /** `auto` in place of the stored adjustments: «Автоцены» sends what the nights will carry before storing it. */
  async bookingTargets(
    propertyId: string,
    from: string,
    to: string,
    auto?: ReadonlyMap<string, number>,
  ): Promise<Map<string, number>> {
    const [base, typed, rule, stored] = await Promise.all([
      this.baseRepo.find({ where: { propertyId, date: Between(from, to) } }),
      this.nightPriceRepo.find({ where: { propertyId, channel: 'booking', date: Between(from, to) } }),
      this.channelRepo.findOne({ where: { propertyId, channel: 'booking' } }),
      auto ? Promise.resolve(auto) : this.autoAdjustments(propertyId, from, to),
    ]);
    const adjustments = [...stored].filter(([d]) => d >= from && d <= to);
    const dates: string[] = [];
    for (let d = from; d <= to; d = addDaysYmd(d, 1)) dates.push(d);
    const baseByDate = Object.fromEntries(base.map((b) => [b.date, b.priceMinor / 100]));
    const typedByDate = Object.fromEntries(typed.map((t) => [t.date, t.priceMinor / 100]));
    const targets = channelTargets(dates, baseByDate, typedByDate, rule?.markupPct ?? 0);
    if (adjustments.length > 0) {
      const min = await this.dates.minPriceOf(propertyId);
      for (const [date, pct] of adjustments) {
        const b = baseByDate[date];
        if (!targets.has(date) || typedByDate[date] != null || b == null || !(b > 0)) continue;
        targets.set(date, autoChannelPrice(b, pct, rule?.markupPct ?? 0, min));
      }
    }
    return targets;
  }

  /** Markup of the Booking channel (0 when not set). */
  async bookingMarkup(propertyId: string): Promise<number> {
    const rule = await this.channelRepo.findOne({ where: { propertyId, channel: 'booking' } });
    return rule?.markupPct ?? 0;
  }

  /** Base prices and the nights with a Booking price typed by hand, for [from, to]. */
  async nightsSource(propertyId: string, from: string, to: string): Promise<{ base: Map<string, number>; typed: Set<string> }> {
    const [base, typed] = await Promise.all([
      this.baseRepo.find({ where: { propertyId, date: Between(from, to) } }),
      this.nightPriceRepo.find({ where: { propertyId, channel: 'booking', date: Between(from, to) } }),
    ]);
    return { base: new Map(base.map((b) => [b.date, b.priceMinor / 100])), typed: new Set(typed.map((t) => t.date)) };
  }

  /** What «Отправить в Booking» would change for [from, to]. Reads Booking, writes nothing. */
  async previewBooking(user: JwtPayload, propertyId: string, dto: BookingSendDto): Promise<BookingPreview> {
    this.assertOn();
    this.assertRange(dto.from, dto.to);
    const property = await this.owned(user, propertyId);
    const targets = await this.tables(() => this.bookingTargets(property.id, dto.from, dto.to));
    if (targets.size === 0) throw new BadRequestException('На эти ночи нет базовой цены');
    const preview = await this.dates.previewPrices(user, property.id, targets);
    return { ...preview, fingerprint: targetsFingerprint(targets) };
  }

  /**
   * Sends the Booking prices of [from, to] — only on the person's command, only for the pilot, and only
   * the prices the person saw in the preview (`fingerprint`); anything changed since → 409, check again.
   */
  async sendBooking(user: JwtPayload, propertyId: string, dto: BookingSendConfirmDto): Promise<CalendarDatesJob> {
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
    if (targetsFingerprint(targets) !== dto.fingerprint) {
      throw new ConflictException('Цены изменились после проверки — нажмите «Проверить» ещё раз');
    }
    return this.dates.startPrices(user, property.id, targets);
  }
}
