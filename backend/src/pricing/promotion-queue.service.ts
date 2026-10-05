import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PropertyService } from '../property/property.service';
import { PricingConfig } from './pricing-config';
import {
  PromotionExecutorService,
  type ExecutorEvent,
  type ExecutorOutcome,
} from './promotion-executor.service';
import { PricePromotionTargetEntity } from './entities/price-promotion-target.entity';
import { PricePromotionEventEntity } from './entities/price-promotion-event.entity';
import { PropertyPricingSettingsEntity } from './entities/property-pricing-settings.entity';

export const PROMOTION_MAX_ATTEMPTS = 6;

/** Retry delay after `attempts` failures: 1, 2, 4 … 60 min; throttling starts at 15 min. */
export function promotionBackoffMs(attempts: number, kind: string): number {
  const baseMinutes = kind === 'RATE_LIMITED' ? 15 : 1;
  const minutes = Math.min(60, baseMinutes * 2 ** Math.max(0, attempts - 1));
  return minutes * 60_000;
}

/**
 * Persistent queue of promotion writes (state lives in price_promotion_targets.needsPush, survives restarts).
 * One property at a time, with a pause; every upstream call also passes the global Zodomus limiter.
 * Not started at all unless ZODOMUS_PROMOTIONS_ENABLED=true.
 */
@Injectable()
export class PromotionQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PromotionQueueService.name);
  private timer: NodeJS.Timeout | null = null;
  private kickTimer: NodeJS.Timeout | null = null;
  private running = false;
  private rerun = false;

  constructor(
    private readonly cfg: PricingConfig,
    private readonly executor: PromotionExecutorService,
    private readonly propertyService: PropertyService,
    @InjectRepository(PricePromotionTargetEntity)
    private readonly targetRepo: Repository<PricePromotionTargetEntity>,
    @InjectRepository(PricePromotionEventEntity)
    private readonly eventRepo: Repository<PricePromotionEventEntity>,
    @InjectRepository(PropertyPricingSettingsEntity)
    private readonly settingsRepo: Repository<PropertyPricingSettingsEntity>,
  ) {}

  onModuleInit(): void {
    if (!this.cfg.flags.enabled) {
      this.logger.log('Booking promotions disabled — queue not started');
      return;
    }
    const ms = this.cfg.flags.queueIntervalSeconds * 1000;
    this.timer = setInterval(() => void this.tick(), ms);
    this.logger.log(
      `Booking promotions queue started (every ${this.cfg.flags.queueIntervalSeconds}s, dryRun=${this.cfg.flags.dryRun})`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.timer = null;
    this.kickTimer = null;
  }

  /** Process soon after a user action (debounced). */
  kick(): void {
    if (!this.cfg.flags.enabled) return;
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null;
      void this.tick();
    }, 1000);
  }

  async tick(): Promise<void> {
    if (!this.cfg.flags.enabled) return;
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.rerun = false;
        await this.drain();
      } while (this.rerun);
    } catch (e) {
      this.logger.error(`promotions queue tick failed: ${String(e)}`);
    } finally {
      this.running = false;
    }
  }

  private async drain(): Promise<void> {
    const due = await this.targetRepo
      .createQueryBuilder('t')
      .where('t.needsPush = true')
      .andWhere('(t.nextAttemptAt IS NULL OR t.nextAttemptAt <= :now)', { now: new Date() })
      .orderBy('t.updatedAt', 'ASC')
      .take(25)
      .getMany();
    for (let i = 0; i < due.length; i++) {
      await this.processOne(due[i]!.id);
      if (this.cfg.flags.gapMs > 0 && i < due.length - 1) {
        await new Promise((r) => setTimeout(r, this.cfg.flags.gapMs));
      }
    }
  }

  async processOne(targetId: string): Promise<void> {
    const target = await this.targetRepo.findOne({
      where: { id: targetId },
      relations: ['promotion'],
    });
    if (!target || !target.needsPush) return;

    const property = await this.propertyService.findByIdBare(target.propertyId);
    let outcome: ExecutorOutcome;
    if (!property) {
      outcome = {
        patch: {
          state: 'error',
          needsPush: false,
          lastErrorCode: 'PROPERTY_NOT_FOUND',
          lastError: 'Объект удалён',
        },
        retry: null,
        events: [],
      };
    } else {
      const settings = await this.settingsRepo.findOne({
        where: { propertyId: target.propertyId },
      });
      outcome = await this.executor.process({
        target,
        promotion: target.promotion,
        property,
        settings,
      });
    }

    const patch = { ...outcome.patch };
    const events: ExecutorEvent[] = [...outcome.events];
    if (outcome.retry) {
      const attempts = target.attempts + 1;
      patch.attempts = attempts;
      patch.lastErrorCode = outcome.retry.kind;
      patch.lastError = outcome.retry.message;
      if (attempts >= PROMOTION_MAX_ATTEMPTS) {
        patch.state = 'error';
        patch.needsPush = false;
        patch.nextAttemptAt = null;
        events.push({
          action: 'error',
          message: `Не удалось после ${attempts} попыток: ${outcome.retry.kind}`,
          details: { error: outcome.retry.message },
        });
      } else {
        const delay = promotionBackoffMs(attempts, outcome.retry.kind);
        patch.nextAttemptAt = new Date(Date.now() + delay);
        events.push({
          action: 'retry_scheduled',
          message: `Временная ошибка ${outcome.retry.kind} — повторим через ${Math.round(delay / 60_000)} мин`,
        });
      }
    }

    await this.targetRepo.update(target.id, patch);
    if (events.length) {
      await this.eventRepo.save(
        events.map((ev) =>
          this.eventRepo.create({
            promotionId: target.promotionId,
            propertyId: target.propertyId,
            actorUserId: null,
            actorLabel: 'RentAI',
            action: ev.action,
            message: property ? `${property.name}: ${ev.message}` : ev.message,
            details: ev.details ?? null,
          }),
        ),
      );
    }
  }
}
