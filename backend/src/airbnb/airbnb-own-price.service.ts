import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { PropertyBasePriceEntity } from '../pricing/entities/property-base-price.entity';
import { PropertyChannelPricingEntity } from '../pricing/entities/property-channel-pricing.entity';
import { PropertyChannelNightPriceEntity } from '../pricing/entities/property-channel-night-price.entity';
import { PropertyPriceDiscountEntity } from '../pricing/entities/property-price-discount.entity';
import { discountPctByNight } from '../pricing/discount.util';
import { addDaysYmd, ownAirbnbPrices } from './airbnb-calendar.util';

/** Emitted by «Цены» when something the Airbnb price is made of changed; `to` included. */
export const AIRBNB_OWN_PRICES_CHANGED = 'pricing.airbnb-own-prices-changed';
export interface AirbnbOwnPricesChanged {
  propertyId: string;
  from: string;
  to: string;
}

function toBool(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

/**
 * RentAI's own Airbnb price per night (owner's rule 2026-11-05): the price typed for Airbnb, else the base
 * price with the Airbnb markup. Off (ZODOMUS_AIRBNB_PRICE_FROM_BASE=false, the default): returns nothing and
 * reads nothing — Airbnb keeps the Booking rule (Booking price − biggest Basic).
 */
@Injectable()
export class AirbnbOwnPriceService {
  private readonly logger = new Logger(AirbnbOwnPriceService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(PropertyBasePriceEntity) private readonly base: Repository<PropertyBasePriceEntity>,
    @InjectRepository(PropertyChannelPricingEntity) private readonly channels: Repository<PropertyChannelPricingEntity>,
    @InjectRepository(PropertyChannelNightPriceEntity) private readonly typed: Repository<PropertyChannelNightPriceEntity>,
    @Optional()
    @InjectRepository(PropertyPriceDiscountEntity)
    private readonly discounts?: Repository<PropertyPriceDiscountEntity>,
  ) {}

  /** «Скидка» (ZODOMUS_PROMOTIONS_DISCOUNTS_ENABLED) lowers the own Airbnb price; off — the table is never read. */
  private get discountsOn(): boolean {
    return Boolean(this.discounts) && toBool(this.config.get('ZODOMUS_PROMOTIONS_DISCOUNTS_ENABLED'));
  }

  /** Night → biggest Airbnb discount of [from, last]; empty when off or unreadable (logged: prices go undiscounted). */
  private async discountPcts(propertyId: string, from: string, last: string): Promise<Map<string, number>> {
    if (!this.discountsOn) return new Map();
    try {
      const rows = await this.discounts!.find({ where: { propertyId, dateFrom: LessThanOrEqual(last), dateTo: MoreThanOrEqual(from) } });
      return discountPctByNight(rows, 'airbnb', from, last, addDaysYmd);
    } catch (e) {
      this.logger.warn(`Airbnb discounts of ${propertyId} unreadable — sent without them: ${e instanceof Error ? e.message : String(e)}`);
      return new Map();
    }
  }

  get enabled(): boolean {
    return toBool(this.config.get('ZODOMUS_AIRBNB_PRICE_FROM_BASE'));
  }

  /**
   * Own Airbnb prices of the nights [from, toExclusive). Null when off. Tables missing or unreadable → null
   * too (logged): the Booking rule applies instead of a night going out at a wrong price.
   */
  async prices(propertyId: string, from: string, toExclusive: string, min: number | null): Promise<Map<string, number> | null> {
    if (!this.enabled || from >= toExclusive) return null;
    const last = addDaysYmd(toExclusive, -1);
    try {
      const [base, typed, rule, pcts] = await Promise.all([
        this.base.find({ where: { propertyId, date: Between(from, last) } }),
        this.typed.find({ where: { propertyId, channel: 'airbnb', date: Between(from, last) } }),
        this.channels.findOne({ where: { propertyId, channel: 'airbnb' } }),
        this.discountPcts(propertyId, from, last),
      ]);
      const dates: string[] = [];
      for (let d = from; d < toExclusive; d = addDaysYmd(d, 1)) dates.push(d);
      return ownAirbnbPrices(
        dates,
        new Map(base.map((b) => [b.date, b.priceMinor / 100])),
        new Map(typed.map((t) => [t.date, t.priceMinor / 100])),
        rule?.markupPct ?? 0,
        min,
        pcts,
      );
    } catch (e) {
      this.logger.warn(`own Airbnb prices of ${propertyId} unreadable — Booking rule used: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }
}
