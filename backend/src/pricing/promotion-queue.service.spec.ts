import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { PricingConfig } from './pricing-config';
import {
  PROMOTION_MAX_ATTEMPTS,
  PromotionQueueService,
  promotionBackoffMs,
} from './promotion-queue.service';
import type { ExecutorOutcome, PromotionExecutorService } from './promotion-executor.service';
import type { PropertyService } from '../property/property.service';
import type { PricePromotionTargetEntity } from './entities/price-promotion-target.entity';
import type { PricePromotionEventEntity } from './entities/price-promotion-event.entity';
import type { PropertyPricingSettingsEntity } from './entities/property-pricing-settings.entity';

function makeCfg(enabled = true): PricingConfig {
  const values: Record<string, unknown> = {
    ZODOMUS_ENABLED: true,
    ZODOMUS_PROMOTIONS_ENABLED: enabled,
    ZODOMUS_PROMOTIONS_GAP_MS: 0,
  };
  return new PricingConfig({ get: (k: string) => values[k] } as unknown as ConfigService);
}

function setup(
  outcome: ExecutorOutcome,
  target: Partial<PricePromotionTargetEntity> = {},
  enabled = true,
) {
  const row = {
    id: 't1',
    promotionId: 'p1',
    propertyId: 'prop-1',
    needsPush: true,
    attempts: 0,
    promotion: { id: 'p1', status: 'active' },
    ...target,
  };
  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([row]),
  };
  const targetRepo = {
    findOne: jest.fn().mockResolvedValue(row),
    update: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  };
  const eventRepo = {
    create: jest.fn((x: unknown) => x),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const settingsRepo = { findOne: jest.fn().mockResolvedValue(null) };
  const propertyService = {
    findByIdBare: jest.fn().mockResolvedValue({ id: 'prop-1', name: 'Мокотув' }),
  };
  const executor = { process: jest.fn().mockResolvedValue(outcome) };
  const svc = new PromotionQueueService(
    makeCfg(enabled),
    executor as unknown as PromotionExecutorService,
    propertyService as unknown as PropertyService,
    targetRepo as unknown as Repository<PricePromotionTargetEntity>,
    eventRepo as unknown as Repository<PricePromotionEventEntity>,
    settingsRepo as unknown as Repository<PropertyPricingSettingsEntity>,
  );
  return { svc, targetRepo, eventRepo, executor };
}

describe('promotionBackoffMs', () => {
  it('doubles from 1 min up to 60 min; throttling starts at 15 min', () => {
    expect(promotionBackoffMs(1, 'TRANSIENT')).toBe(60_000);
    expect(promotionBackoffMs(3, 'TRANSIENT')).toBe(4 * 60_000);
    expect(promotionBackoffMs(10, 'TRANSIENT')).toBe(60 * 60_000);
    expect(promotionBackoffMs(1, 'RATE_LIMITED')).toBe(15 * 60_000);
  });
});

describe('PromotionQueueService', () => {
  it('persists a successful outcome and labels events with the property name', async () => {
    const { svc, targetRepo, eventRepo } = setup({
      patch: { state: 'on', needsPush: false, externalPromotionId: 'VR1' },
      retry: null,
      events: [{ action: 'created', message: 'Акция VR1 создана на Booking' }],
    });
    await svc.processOne('t1');
    expect(targetRepo.update).toHaveBeenCalledWith('t1', {
      state: 'on',
      needsPush: false,
      externalPromotionId: 'VR1',
    });
    expect(eventRepo.save).toHaveBeenCalledWith([
      expect.objectContaining({
        promotionId: 'p1',
        propertyId: 'prop-1',
        actorLabel: 'RentAI',
        message: 'Мокотув: Акция VR1 создана на Booking',
      }),
    ]);
  });

  it('schedules a retry with backoff on a temporary failure', async () => {
    const { svc, targetRepo, eventRepo } = setup({
      patch: {},
      retry: { kind: 'TRANSIENT', message: 'timeout' },
      events: [],
    });
    const before = Date.now();
    await svc.processOne('t1');
    const patch = targetRepo.update.mock.calls[0]![1] as Partial<PricePromotionTargetEntity>;
    expect(patch).toMatchObject({ attempts: 1, lastErrorCode: 'TRANSIENT', lastError: 'timeout' });
    expect(patch.needsPush).toBeUndefined();
    expect(patch.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    expect(eventRepo.save).toHaveBeenCalledWith([
      expect.objectContaining({ action: 'retry_scheduled' }),
    ]);
  });

  it('gives up after the maximum number of attempts', async () => {
    const { svc, targetRepo } = setup(
      { patch: {}, retry: { kind: 'TRANSIENT', message: 'still down' }, events: [] },
      { attempts: PROMOTION_MAX_ATTEMPTS - 1 },
    );
    await svc.processOne('t1');
    expect(targetRepo.update.mock.calls[0]![1]).toMatchObject({
      state: 'error',
      needsPush: false,
      nextAttemptAt: null,
      attempts: PROMOTION_MAX_ATTEMPTS,
    });
  });

  it('ignores targets that no longer need a push', async () => {
    const { svc, executor, targetRepo } = setup(
      { patch: {}, retry: null, events: [] },
      { needsPush: false },
    );
    await svc.processOne('t1');
    expect(executor.process).not.toHaveBeenCalled();
    expect(targetRepo.update).not.toHaveBeenCalled();
  });

  it('does nothing at all while the feature is disabled', async () => {
    const { svc, targetRepo, executor } = setup({ patch: {}, retry: null, events: [] }, {}, false);
    svc.onModuleInit();
    await svc.tick();
    svc.kick();
    expect(targetRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(executor.process).not.toHaveBeenCalled();
    svc.onModuleDestroy();
  });

  it('drains due targets when enabled', async () => {
    const { svc, executor } = setup({
      patch: { state: 'on', needsPush: false },
      retry: null,
      events: [],
    });
    await svc.tick();
    expect(executor.process).toHaveBeenCalledTimes(1);
  });
});
