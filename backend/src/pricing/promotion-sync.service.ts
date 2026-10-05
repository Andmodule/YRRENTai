import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ZodomusService } from '../integrations/zodomus/zodomus.service';
import { PropertyService } from '../property/property.service';
import type { PropertyEntity } from '../property/entities/property.entity';
import {
  classifyPromotionError,
  parsePromotionsResponse,
  type ParsedPromotion,
} from '../integrations/zodomus/zodomus-promotions.util';
import { PricingConfig } from './pricing-config';
import { hasRentaiMarker, normalizeWeekdays, todayInTz } from './pricing-math.util';
import { PricePromotionEntity } from './entities/price-promotion.entity';
import {
  PricePromotionTargetEntity,
  type PromotionTargetPatch,
  type PromotionTargetStats,
} from './entities/price-promotion-target.entity';
import { PricePromotionEventEntity } from './entities/price-promotion-event.entity';
import {
  PropertyPricingSettingsEntity,
  type PromotionsAccess,
} from './entities/property-pricing-settings.entity';

const STARTUP_DELAY_MS = 120_000;

export type PropertySyncResult = { propertyId: string; access: PromotionsAccess; code?: string };

function toStats(p: ParsedPromotion): PromotionTargetStats | null {
  if (!p.stats) return null;
  return {
    bookings: p.stats.bookings,
    nights: p.stats.nights,
    revenue: p.stats.revenue,
    currency: p.stats.currency,
    cancellations: p.stats.cancellations,
    at: new Date().toISOString(),
  };
}

/**
 * Read-only reconciliation with Booking (GET /promotions per property):
 * access check, stats and status of our promotions, deals created in the extranet.
 * Writes only to RentAI tables; never calls create/activate/deactivate.
 */
@Injectable()
export class PromotionSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PromotionSyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly cfg: PricingConfig,
    private readonly zodomus: ZodomusService,
    private readonly propertyService: PropertyService,
    @InjectRepository(PricePromotionEntity)
    private readonly promotionRepo: Repository<PricePromotionEntity>,
    @InjectRepository(PricePromotionTargetEntity)
    private readonly targetRepo: Repository<PricePromotionTargetEntity>,
    @InjectRepository(PricePromotionEventEntity)
    private readonly eventRepo: Repository<PricePromotionEventEntity>,
    @InjectRepository(PropertyPricingSettingsEntity)
    private readonly settingsRepo: Repository<PropertyPricingSettingsEntity>,
  ) {}

  onModuleInit(): void {
    if (!this.cfg.flags.enabled) {
      this.logger.log('Booking promotions disabled — sync not started');
      return;
    }
    const ms = this.cfg.flags.syncMinutes * 60_000;
    this.timer = setInterval(() => void this.syncAll(), ms);
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      void this.syncAll();
    }, STARTUP_DELAY_MS);
    this.logger.log(`Booking promotions sync started (every ${this.cfg.flags.syncMinutes} min)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.timer = null;
    this.startupTimer = null;
  }

  /** Booking hotel id of the property on the promotions channel (null = not on Booking). */
  externalIdOf(property: PropertyEntity): string | null {
    return this.propertyService.getExternalListingIdForZodomusChannel(
      property,
      this.cfg.flags.channelId,
    );
  }

  async syncAll(): Promise<void> {
    if (!this.cfg.flags.enabled || this.running) return;
    this.running = true;
    try {
      const properties = (await this.propertyService.findAllWithZodomus()).filter((p) =>
        this.externalIdOf(p),
      );
      await this.syncProperties(properties);
    } catch (e) {
      this.logger.error(`promotions sync failed: ${String(e)}`);
    } finally {
      this.running = false;
    }
  }

  /** On demand («Проверить доступ к акциям»): same read-only routine for the given properties. */
  async syncProperties(properties: PropertyEntity[]): Promise<PropertySyncResult[]> {
    const out: PropertySyncResult[] = [];
    for (let i = 0; i < properties.length; i++) {
      out.push(await this.syncProperty(properties[i]!));
      if (this.cfg.flags.gapMs > 0 && i < properties.length - 1) {
        await new Promise((r) => setTimeout(r, this.cfg.flags.gapMs));
      }
    }
    return out;
  }

  async syncProperty(property: PropertyEntity): Promise<PropertySyncResult> {
    const channelId = this.cfg.flags.channelId;
    const ext = this.externalIdOf(property);
    if (!ext) return { propertyId: property.id, access: 'unknown', code: 'NO_BOOKING' };

    let active: ParsedPromotion[];
    try {
      active = parsePromotionsResponse(await this.zodomus.getPromotions(channelId, ext, 1));
    } catch (e) {
      const c = classifyPromotionError(e);
      const said = c.message.replace(/\s+/g, ' ').slice(0, 300);
      if (c.retryable) {
        this.logger.warn(`promotions sync ${property.id}: temporary ${c.kind} — ${said}`);
        await this.saveCheckFailure(property.id, c.kind, c.message);
        return { propertyId: property.id, access: 'unknown', code: c.kind };
      }
      this.logger.warn(`promotions sync ${property.id}: no access ${c.kind} — ${said}`);
      await this.saveAccess(property.id, 'denied', c.kind, c.message);
      return { propertyId: property.id, access: 'denied', code: c.kind };
    }
    await this.saveAccess(property.id, 'ok', null, null);

    const byId = new Map(active.map((p) => [p.id, p]));
    const targets = await this.targetRepo.find({
      where: { propertyId: property.id },
      relations: ['promotion'],
    });
    const knownIds = new Set<string>();
    for (const t of targets) {
      if (t.externalPromotionId) knownIds.add(t.externalPromotionId);
      for (const p of t.previousExternalIds ?? []) knownIds.add(p.id);
    }

    let inactive: ParsedPromotion[] | null | undefined;
    const loadInactive = async (): Promise<ParsedPromotion[] | null> => {
      if (inactive !== undefined) return inactive;
      try {
        inactive = parsePromotionsResponse(await this.zodomus.getPromotions(channelId, ext, 0));
      } catch {
        inactive = null;
      }
      return inactive;
    };

    const now = new Date();
    for (const t of targets) {
      if (!t.externalPromotionId) continue;
      const hit = byId.get(t.externalPromotionId);

      if (t.promotion.source === 'booking') {
        if (hit) {
          await this.targetRepo.update(t.id, {
            state: 'on',
            stats: toStats(hit) ?? t.stats,
            lastSyncedAt: now,
          });
          await this.promotionRepo.update(t.promotionId, {
            name: hit.name || t.promotion.name,
            discountPct: hit.discountPct ?? t.promotion.discountPct,
            stayFrom: hit.stayStart,
            stayTo: hit.stayEnd,
            activeWeekdays: normalizeWeekdays(hit.weekdays),
            status: 'active',
          });
        } else if (t.state !== 'off') {
          await this.targetRepo.update(t.id, { state: 'off', lastSyncedAt: now });
          await this.promotionRepo.update(t.promotionId, { status: 'off' });
          await this.addEvent(
            t,
            'gone_externally',
            'Скидка больше не действует в экстранете Booking',
          );
        }
        continue;
      }

      if (hit) {
        const patch: PromotionTargetPatch = { stats: toStats(hit) ?? t.stats, lastSyncedAt: now };
        // Still active on Booking although we switched it off → send the deactivation again.
        if (t.desiredState === 'off' && t.state === 'off' && !this.cfg.flags.dryRun) {
          patch.state = 'on';
          patch.needsPush = true;
          patch.attempts = 0;
          patch.nextAttemptAt = null;
          await this.addEvent(t, 'drift', 'Акция всё ещё активна на Booking — повторим выключение');
        }
        await this.targetRepo.update(t.id, patch);
      } else if (t.state === 'on') {
        const deactivated =
          (await loadInactive())?.some((p) => p.id === t.externalPromotionId) ?? false;
        if (deactivated) {
          await this.targetRepo.update(t.id, {
            state: 'off',
            desiredState: 'off',
            needsPush: false,
            lastSyncedAt: now,
          });
          await this.addEvent(t, 'deactivated_externally', 'Акцию выключили в экстранете Booking');
        } else {
          await this.targetRepo.update(t.id, {
            verifyNote: 'NOT_FOUND_ON_SYNC: акции нет в ответе Booking',
            lastSyncedAt: now,
          });
        }
      }
    }

    const today = todayInTz(property.timezone);
    for (const p of active) {
      if (knownIds.has(p.id) || hasRentaiMarker(p.name)) continue;
      if (p.stayEnd && p.stayEnd < today) continue;
      await this.importExtranetPromotion(property, ext, p);
    }
    return { propertyId: property.id, access: 'ok' };
  }

  private async importExtranetPromotion(
    property: PropertyEntity,
    ext: string,
    p: ParsedPromotion,
  ): Promise<void> {
    const promotion = await this.promotionRepo.save(
      this.promotionRepo.create({
        ownerId: property.ownerId,
        companyId: property.companyId ?? null,
        name: (p.name || 'Акция Booking').slice(0, 255),
        source: 'booking',
        promotionType: p.type ?? 'basic',
        discountPct: p.discountPct ?? 0,
        stayFrom: p.stayStart,
        stayTo: p.stayEnd,
        activeWeekdays: normalizeWeekdays(p.weekdays),
        protectMinPrice: false,
        status: 'active',
        externalMeta: {
          lastMinute: p.lastMinute,
          earlyBookerDays: p.earlyBookerDays,
          targetChannel: p.targetChannel,
        },
        createdByUserId: null,
      }),
    );
    const target = await this.targetRepo.save(
      this.targetRepo.create({
        promotionId: promotion.id,
        propertyId: property.id,
        channelId: this.cfg.flags.channelId,
        externalPropertyId: ext,
        desiredState: 'on',
        state: 'on',
        needsPush: false,
        externalPromotionId: p.id,
        previousExternalIds: [],
        roomIds: p.roomIds,
        rateIds: p.rateIds,
        stats: toStats(p),
        lastSyncedAt: new Date(),
      }),
    );
    await this.addEvent(
      target,
      'imported',
      `Найдена при сверке с Booking.com: создана в экстранете (${p.type ?? 'basic'}, −${p.discountPct ?? '?'}%)`,
    );
  }

  private async saveAccess(
    propertyId: string,
    access: PromotionsAccess,
    code: string | null,
    detail: string | null,
  ): Promise<void> {
    await this.settingsRepo.upsert(
      {
        propertyId,
        promotionsAccess: access,
        promotionsAccessCode: code,
        promotionsAccessDetail: detail ? detail.slice(0, 2000) : null,
        promotionsAccessCheckedAt: new Date(),
      },
      ['propertyId'],
    );
  }

  /**
   * The check failed in a way that may be a glitch: keep the last known access, but record the
   * time and what Zodomus answered so «Минимальные цены» can show it (and stop waiting).
   */
  private async saveCheckFailure(propertyId: string, code: string, detail: string): Promise<void> {
    const prev = await this.settingsRepo.findOne({ where: { propertyId } });
    await this.saveAccess(propertyId, prev?.promotionsAccess ?? 'unknown', code, detail);
  }

  private async addEvent(
    t: Pick<PricePromotionTargetEntity, 'promotionId' | 'propertyId'>,
    action: string,
    message: string,
  ): Promise<void> {
    await this.eventRepo.save(
      this.eventRepo.create({
        promotionId: t.promotionId,
        propertyId: t.propertyId,
        actorUserId: null,
        actorLabel: 'RentAI',
        action,
        message,
        details: null,
      }),
    );
  }

  /** Access status of the given properties (for «Минимальные цены»). */
  async accessMap(propertyIds: string[]): Promise<Map<string, PropertyPricingSettingsEntity>> {
    if (propertyIds.length === 0) return new Map();
    const rows = await this.settingsRepo.find({ where: { propertyId: In(propertyIds) } });
    return new Map(rows.map((r) => [r.propertyId, r]));
  }
}
