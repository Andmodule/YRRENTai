import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataSource, Repository } from 'typeorm';
import { PricingConfig } from './pricing-config';
import { PricingService, effectiveStayWindow } from './pricing.service';
import { addDaysYmd, todayInTz } from './pricing-math.util';
import { PricePromotionEntity } from './entities/price-promotion.entity';
import { PricePromotionTargetEntity } from './entities/price-promotion-target.entity';
import { PricePromotionEventEntity } from './entities/price-promotion-event.entity';
import type { PropertyPricingSettingsEntity } from './entities/property-pricing-settings.entity';
import type { UserService } from '../user/user.service';
import type { PropertyService } from '../property/property.service';
import type { PromotionExecutorService } from './promotion-executor.service';
import type { PromotionQueueService } from './promotion-queue.service';
import type { PromotionSyncService } from './promotion-sync.service';
import type { JwtPayload } from '../common/decorators/current-user.decorator';

type Row = Record<string, unknown> & { id?: string };

const FROM = addDaysYmd(todayInTz('UTC'), 20);
const TO = addDaysYmd(todayInTz('UTC'), 26);
const OWNER: JwtPayload = { sub: 'u1', email: 'anna@example.com', role: 'OWNER' };
const STRANGER: JwtPayload = { sub: 'u2', email: 'x@example.com', role: 'OWNER' };

const PROPS = [
  { id: 'a', name: 'Мокотув', timezone: 'UTC', companyId: 'c1', ext: 'EXT-A' },
  { id: 'b', name: 'Воля', timezone: 'UTC', companyId: 'c1', ext: 'EXT-B' },
  { id: 'c', name: 'Урсус (Airbnb)', timezone: 'UTC', companyId: 'c1', ext: null },
  { id: 'd', name: 'Белоленка', timezone: 'UTC', companyId: 'c1', ext: 'EXT-D' },
];

/** Tiny in-memory store with just the repository calls PricingService makes. */
function makeDb() {
  let seq = 0;
  const db = {
    promotions: [] as Row[],
    targets: [] as Row[],
    events: [] as Row[],
    settings: [] as Row[],
  };
  const match = (row: Row, where?: Record<string, unknown>) =>
    Object.entries(where ?? {}).every(([k, v]) => row[k] === v);
  const put = (table: 'promotions' | 'targets' | 'events') => (r: Row) => {
    if (!r.id) r.id = `${table}-${++seq}`;
    if (!r.createdAt) r.createdAt = new Date();
    const i = db[table].findIndex((o) => o.id === r.id);
    if (i >= 0) db[table][i] = { ...db[table][i], ...r };
    else db[table].push({ ...r });
    return r;
  };
  const withTargets = (p: Row | undefined) =>
    p
      ? { ...p, targets: db.targets.filter((t) => t.promotionId === p.id).map((t) => ({ ...t })) }
      : null;

  const promotionRepo = {
    create: (x: Row) => ({ ...x }),
    save: jest.fn(async (x: Row) => {
      const { targets: _t, ...rest } = x;
      put('promotions')(rest);
      x.id = rest.id;
      return x;
    }),
    find: jest.fn(async (o: { where?: Record<string, unknown> }) =>
      db.promotions.filter((p) => match(p, o.where)).map(withTargets),
    ),
    findOne: jest.fn(async (o: { where?: Record<string, unknown> }) =>
      withTargets(db.promotions.find((p) => match(p, o.where))),
    ),
  };
  const targetRepo = {
    create: (x: Row) => ({ ...x }),
    save: jest.fn(async (x: Row | Row[]) => {
      (Array.isArray(x) ? x : [x]).forEach(put('targets'));
      return x;
    }),
  };
  const eventRepo = {
    create: (x: Row) => ({ ...x }),
    save: jest.fn(async (x: Row | Row[]) => {
      (Array.isArray(x) ? x : [x]).forEach(put('events'));
      return x;
    }),
    find: jest.fn(async (o: { where?: Record<string, unknown> }) =>
      db.events.filter((e) => match(e, o.where)),
    ),
  };
  const settingsRepo = {
    upsert: jest.fn(async (row: Row) => {
      const i = db.settings.findIndex((s) => s.propertyId === row.propertyId);
      if (i >= 0) db.settings[i] = { ...db.settings[i], ...row };
      else db.settings.push({ ...row });
    }),
    findOne: jest.fn(
      async (o: { where: { propertyId: string } }) =>
        db.settings.find((s) => s.propertyId === o.where.propertyId) ?? null,
    ),
  };
  const repos = new Map<unknown, unknown>([
    [PricePromotionEntity, promotionRepo],
    [PricePromotionTargetEntity, targetRepo],
    [PricePromotionEventEntity, eventRepo],
  ]);
  const dataSource = {
    transaction: jest.fn(async (cb: (em: { getRepository: (e: unknown) => unknown }) => unknown) =>
      cb({ getRepository: (e: unknown) => repos.get(e) }),
    ),
  };
  return { db, promotionRepo, targetRepo, eventRepo, settingsRepo, dataSource };
}

function makeService(enabled = true) {
  const values: Record<string, unknown> = {
    ZODOMUS_ENABLED: true,
    ZODOMUS_PROMOTIONS_ENABLED: enabled,
  };
  const cfg = new PricingConfig({ get: (k: string) => values[k] } as unknown as ConfigService);
  const store = makeDb();
  const userService = {
    resolveTenantOwnerId: jest.fn(async (sub: string) => (sub === 'u1' ? 'owner-1' : 'owner-2')),
    findById: jest.fn(async () => ({ firstName: 'Анна', lastName: '' })),
  };
  const propertyService = {
    findAllByOwner: jest.fn(async (ownerId: string) =>
      ownerId === 'owner-1' ? PROPS.map((p) => ({ ...p })) : [],
    ),
  };
  const sync = {
    externalIdOf: (p: { ext?: string | null }) => p.ext ?? null,
    accessMap: jest.fn(
      async () => new Map([['d', { propertyId: 'd', promotionsAccess: 'denied' }]]),
    ),
  };
  const queue = { kick: jest.fn() };
  const svc = new PricingService(
    cfg,
    userService as unknown as UserService,
    propertyService as unknown as PropertyService,
    {} as PromotionExecutorService,
    queue as unknown as PromotionQueueService,
    sync as unknown as PromotionSyncService,
    store.dataSource as unknown as DataSource,
    store.promotionRepo as unknown as Repository<PricePromotionEntity>,
    store.targetRepo as unknown as Repository<PricePromotionTargetEntity>,
    store.eventRepo as unknown as Repository<PricePromotionEventEntity>,
    store.settingsRepo as unknown as Repository<PropertyPricingSettingsEntity>,
  );
  return { svc, queue, ...store };
}

function seedPromotion(db: ReturnType<typeof makeDb>['db'], over: Row = {}) {
  db.promotions.push({
    id: 'p1',
    ownerId: 'owner-1',
    name: 'Осенняя неделя',
    source: 'rentai',
    promotionType: 'basic',
    discountPct: 10,
    stayFrom: FROM,
    stayTo: TO,
    activeWeekdays: null,
    protectMinPrice: true,
    status: 'active',
    externalMeta: null,
    createdAt: new Date(),
    ...over,
  });
  db.targets.push(
    {
      id: 't-a',
      promotionId: 'p1',
      propertyId: 'a',
      desiredState: 'on',
      state: 'on',
      needsPush: false,
      attempts: 0,
      nextAttemptAt: null,
      stats: null,
      previousExternalIds: [],
    },
    {
      id: 't-b',
      promotionId: 'p1',
      propertyId: 'b',
      desiredState: 'off',
      state: 'off',
      needsPush: false,
      attempts: 0,
      nextAttemptAt: null,
      stats: null,
      previousExternalIds: [],
    },
  );
}

describe('PricingService', () => {
  it('reports status even when disabled, everything else answers 503', async () => {
    const { svc } = makeService(false);
    expect(svc.status()).toMatchObject({ enabled: false, dryRun: true });
    await expect(svc.list(OWNER)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('create: all Booking properties with access get a pending target; others are listed as excluded', async () => {
    const { svc, db, queue } = makeService();
    const res = await svc.create(OWNER, { discountPct: 10, stayFrom: FROM, stayTo: TO });

    expect(
      db.targets.map((t) => [
        t.propertyId,
        t.externalPropertyId,
        t.desiredState,
        t.state,
        t.needsPush,
      ]),
    ).toEqual([
      ['a', 'EXT-A', 'on', 'pending', true],
      ['b', 'EXT-B', 'on', 'pending', true],
    ]);
    expect(db.promotions[0]).toMatchObject({
      ownerId: 'owner-1',
      name: 'Скидка 10%',
      status: 'active',
      protectMinPrice: true,
    });
    expect(db.events.map((e) => e.action)).toEqual(['created', 'excluded']);
    expect(String(db.events[1]!.message)).toContain('Урсус (Airbnb) (нет Booking)');
    expect(String(db.events[1]!.message)).toContain('Белоленка (нет доступа к акциям)');
    expect(res.counts).toMatchObject({ total: 2, pending: 2 });
    expect(queue.kick).toHaveBeenCalled();
  });

  it('create: refuses when no selected property can get the discount', async () => {
    const { svc } = makeService();
    await expect(
      svc.create(OWNER, { discountPct: 10, stayFrom: FROM, stayTo: TO, propertyIds: ['c'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update: changed discount requeues active targets but leaves manually switched-off ones off', async () => {
    const { svc, db } = makeService();
    seedPromotion(db);
    await svc.update(OWNER, 'p1', { discountPct: 15 });

    const a = db.targets.find((t) => t.id === 't-a')!;
    const b = db.targets.find((t) => t.id === 't-b')!;
    expect(a).toMatchObject({ desiredState: 'on', needsPush: true, state: 'on' });
    expect(b).toMatchObject({ desiredState: 'off', needsPush: false, state: 'off' });
    expect(db.promotions[0]).toMatchObject({ discountPct: 15 });
    expect(String(db.events.at(-1)!.message)).toContain('−10% → −15%');
  });

  it('update: name-only change does not touch Booking', async () => {
    const { svc, db } = makeService();
    seedPromotion(db);
    await svc.update(OWNER, 'p1', { name: 'Новая' });
    expect(db.targets.find((t) => t.id === 't-a')).toMatchObject({ needsPush: false });
    expect(db.promotions[0]).toMatchObject({ name: 'Новая' });
  });

  it('extranet promotions are read-only', async () => {
    const { svc, db } = makeService();
    seedPromotion(db, { source: 'booking' });
    await expect(svc.update(OWNER, 'p1', { discountPct: 5 })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(svc.setPromotionActive(OWNER, 'p1', false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('another tenant cannot see or change the promotion', async () => {
    const { svc, db } = makeService();
    seedPromotion(db);
    await expect(svc.get(STRANGER, 'p1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.setPromotionActive(STRANGER, 'p1', false)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('switching the whole discount off requeues every property for deactivation', async () => {
    const { svc, db } = makeService();
    seedPromotion(db);
    const res = await svc.setPromotionActive(OWNER, 'p1', false);
    expect(db.promotions[0]).toMatchObject({ status: 'off' });
    expect(db.targets.every((t) => t.desiredState === 'off' && t.needsPush === true)).toBe(true);
    expect(res.derivedStatus).toBe('off');
  });

  it('per-property switch-off is recorded with the property name', async () => {
    const { svc, db } = makeService();
    seedPromotion(db);
    await svc.targetAction(OWNER, 'p1', 'a', 'off');
    expect(db.targets.find((t) => t.id === 't-a')).toMatchObject({
      desiredState: 'off',
      needsPush: true,
    });
    expect(db.events.at(-1)).toMatchObject({
      action: 'deactivated',
      message: 'Выключена для «Мокотув»',
      propertyId: 'a',
    });
  });

  it('minimum prices are stored in minor units, only for own properties', async () => {
    const { svc, db } = makeService();
    const rows = await svc.updateSettings(OWNER, {
      items: [{ propertyId: 'a', minPrice: 320.5, geniusPct: 10 }],
    });
    expect(db.settings[0]).toMatchObject({ propertyId: 'a', minPriceMinor: 32050, geniusPct: 10 });
    expect(rows.find((r) => r.id === 'c')).toMatchObject({
      bookingConnected: false,
      promotionsAccess: null,
    });
    await expect(
      svc.updateSettings(OWNER, { items: [{ propertyId: 'zzz', minPrice: 1 }] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PricingService — calendar and property views', () => {
  it('lists only discounts that include the property, with its own state', async () => {
    const { svc, db } = makeService();
    seedPromotion(db);
    const forA = await svc.list(OWNER, 'a');
    expect(forA).toHaveLength(1);
    expect(forA[0]).toMatchObject({ id: 'p1', target: { propertyId: 'a', state: 'on' } });
    expect(await svc.list(OWNER, 'c')).toEqual([]);
  });

  it('calendar returns active discounts per property, without manually switched-off ones', async () => {
    const { svc, db } = makeService();
    seedPromotion(db);
    const res = await svc.calendar(OWNER, FROM, TO);
    expect(res).toEqual([
      expect.objectContaining({
        id: 'p1',
        discountPct: 10,
        from: FROM,
        to: TO,
        properties: [{ propertyId: 'a', state: 'on' }],
      }),
    ]);
    await expect(svc.calendar(OWNER, TO, FROM)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.calendar(OWNER, 'x', TO)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('narrows last-minute and early-booker deals to the dates they can apply to', () => {
    const today = '2026-10-05';
    expect(
      effectiveStayWindow(
        {
          stayFrom: '2026-10-01',
          stayTo: '2026-12-31',
          promotionType: 'last_minute',
          externalMeta: { lastMinute: { unit: 'day', value: 3 } },
        },
        today,
      ),
    ).toEqual({ from: '2026-10-05', to: '2026-10-07' });
    expect(
      effectiveStayWindow(
        {
          stayFrom: '2026-10-01',
          stayTo: '2026-12-31',
          promotionType: 'last_minute',
          externalMeta: { lastMinute: { unit: 'hour', value: 8 } },
        },
        today,
      ),
    ).toEqual({ from: '2026-10-05', to: '2026-10-05' });
    expect(
      effectiveStayWindow(
        {
          stayFrom: '2026-10-01',
          stayTo: '2026-12-31',
          promotionType: 'early_booker',
          externalMeta: { earlyBookerDays: 30 },
        },
        today,
      ),
    ).toEqual({ from: '2026-11-04', to: '2026-12-31' });
    expect(
      effectiveStayWindow(
        {
          stayFrom: '2026-10-10',
          stayTo: '2026-10-12',
          promotionType: 'basic',
          externalMeta: null,
        },
        today,
      ),
    ).toEqual({ from: '2026-10-10', to: '2026-10-12' });
    expect(
      effectiveStayWindow(
        { stayFrom: null, stayTo: null, promotionType: 'basic', externalMeta: null },
        today,
      ),
    ).toBeNull();
  });
});
