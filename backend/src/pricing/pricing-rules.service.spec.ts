import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataSource, Repository } from 'typeorm';
import { PricingConfig } from './pricing-config';
import { PricingService } from './pricing.service';
import { PricingRulesService } from './pricing-rules.service';
import { addDaysYmd, todayInTz } from './pricing-math.util';
import { ruleStayTo } from './pricing-rules.util';
import { createRuleSchema, type CreateRuleDto } from './dto/pricing-rules.dto';
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

const OWNER: JwtPayload = { sub: 'u1', email: 'anna@example.com', role: 'OWNER' };
const STRANGER: JwtPayload = { sub: 'u2', email: 'x@example.com', role: 'OWNER' };
const TODAY = todayInTz('Europe/Warsaw');

const PROPS = [
  { id: 'a', name: 'Мокотув', timezone: 'Europe/Warsaw', companyId: 'c1', ext: 'EXT-A' },
  { id: 'b', name: 'Воля', timezone: 'Europe/Warsaw', companyId: 'c1', ext: 'EXT-B' },
  { id: 'c', name: 'Урсус (Airbnb)', timezone: 'Europe/Warsaw', companyId: 'c1', ext: null },
  { id: 'd', name: 'Белоленка', timezone: 'Europe/Warsaw', companyId: 'c1', ext: 'EXT-D' },
];

/** Tiny in-memory store with just the repository calls the services make. */
function makeDb() {
  let seq = 0;
  const db = { promotions: [] as Row[], targets: [] as Row[], events: [] as Row[] };
  // Equality, TypeORM Not(...) and an array of alternatives (OR) — all the find() filters the services use.
  const matchOne = (row: Row, where?: Record<string, unknown>) =>
    Object.entries(where ?? {}).every(([k, v]) =>
      v && typeof v === 'object' && (v as { type?: string }).type === 'not'
        ? row[k] !== (v as { value: unknown }).value
        : row[k] === v,
    );
  const match = (row: Row, where?: Record<string, unknown> | Record<string, unknown>[]) =>
    Array.isArray(where) ? where.some((w) => matchOne(row, w)) : matchOne(row, where);
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
    find: jest.fn(async (o: { where?: Record<string, unknown> | Record<string, unknown>[] }) =>
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
    find: jest.fn(async (o: { where?: Record<string, unknown> | Record<string, unknown>[] }) =>
      db.events.filter((e) => match(e, o.where)),
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
  return { db, promotionRepo, targetRepo, eventRepo, dataSource };
}

function makeServices(over: { rules?: boolean; enabled?: boolean } = {}) {
  const values: Record<string, unknown> = {
    ZODOMUS_ENABLED: true,
    ZODOMUS_PROMOTIONS_ENABLED: over.enabled ?? true,
    ZODOMUS_PROMOTIONS_AUTORULES_ENABLED: over.rules ?? true,
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
  const pricing = new PricingService(
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
    {} as Repository<PropertyPricingSettingsEntity>,
  );
  const rules = new PricingRulesService(
    cfg,
    pricing,
    propertyService as unknown as PropertyService,
    queue as unknown as PromotionQueueService,
    store.dataSource as unknown as DataSource,
    store.promotionRepo as unknown as Repository<PricePromotionEntity>,
    store.targetRepo as unknown as Repository<PricePromotionTargetEntity>,
  );
  return { rules, pricing, queue, cfg, ...store };
}

const LADDER: CreateRuleDto = {
  name: 'Горящие даты',
  horizonMonths: 6,
  steps: [
    { discountPct: 5, unit: 'day', value: 3 },
    { discountPct: 8, unit: 'day', value: 1 },
    { discountPct: 12, unit: 'hour', value: 12, bookTime: { start: 6, end: 12 } },
  ],
};

describe('PricingRulesService', () => {
  it('flag off from the start: nothing can be created, sent again or switched on', async () => {
    const { rules, db } = makeServices({ rules: false });
    await expect(rules.create(OWNER, LADDER)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(rules.resend(OWNER, 'g')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(rules.setActive(OWNER, 'g', true)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(rules.setPropertyActive(OWNER, 'g', 'a', true)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(db.promotions).toHaveLength(0);
    // Reading is allowed (an empty list), so the page can show what exists.
    expect(await rules.list(OWNER)).toEqual([]);
  });

  it('emergency switch-off: with the flag off existing rules stay visible and can still be stopped', async () => {
    const { rules, db, cfg } = makeServices();
    const { groupId } = await rules.create(OWNER, LADDER);
    (cfg.flags as { autoRules: boolean }).autoRules = false;

    expect(await rules.list(OWNER)).toHaveLength(1);

    const one = await rules.setPropertyActive(OWNER, groupId, 'a', false);
    expect(one.properties.find((p) => p.propertyId === 'a')!.state).toBe('off');

    const off = await rules.setActive(OWNER, groupId, false);
    expect(off.status).toBe('off');
    expect(db.targets.every((t) => t.desiredState === 'off' && t.needsPush)).toBe(true);

    // …but nothing can put a discount back on Booking.
    await expect(rules.setActive(OWNER, groupId, true)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(rules.resend(OWNER, groupId)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(rules.setPropertyActive(OWNER, groupId, 'a', true)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(rules.create(OWNER, LADDER)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('promotions off entirely: the rules flag alone does nothing', async () => {
    const { rules } = makeServices({ rules: true, enabled: false });
    await expect(rules.list(OWNER)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('create: one last-minute step per ladder rung, a pending target per eligible property', async () => {
    const { rules, db, queue } = makeServices();
    const view = await rules.create(OWNER, LADDER);

    expect(db.promotions.map((p) => [p.promotionType, p.discountPct, p.name])).toEqual([
      ['last_minute', 5, 'За 3 дня до заезда'],
      ['last_minute', 8, 'За 1 день до заезда'],
      ['last_minute', 12, 'За 12 часов до заезда, бронь 6:00–12:00'],
    ]);
    expect(db.promotions[0]).toMatchObject({
      ownerId: 'owner-1',
      source: 'rentai',
      status: 'active',
      protectMinPrice: true,
      activeWeekdays: null,
      stayFrom: TODAY,
      stayTo: ruleStayTo(TODAY, 6),
    });
    expect(db.promotions[2]!.externalMeta).toMatchObject({
      rule: { name: 'Горящие даты', stepIndex: 2, horizonMonths: 6 },
      lastMinute: { unit: 'hour', value: 12 },
      bookTime: { start: 6, end: 12 },
    });
    // Eligible: «Мокотув», «Воля». Not on Booking («Урсус») and no promotions access («Белоленка») are left out.
    expect(db.targets).toHaveLength(6);
    expect(new Set(db.targets.map((t) => t.propertyId))).toEqual(new Set(['a', 'b']));
    expect(db.targets.every((t) => t.state === 'pending' && t.needsPush && t.desiredState === 'on')).toBe(true);
    expect(db.events.map((e) => e.action)).toEqual(['created', 'created', 'created']);
    expect(queue.kick).toHaveBeenCalled();

    expect(view).toMatchObject({ name: 'Горящие даты', status: 'active', horizonMonths: 6 });
    expect(view.steps.map((s) => s.discountPct)).toEqual([5, 8, 12]);
    expect(view.counts).toMatchObject({ total: 6, pending: 6 });
    expect(view.properties.map((p) => [p.propertyId, p.state])).toEqual([
      ['a', 'pending'],
      ['b', 'pending'],
    ]);
  });

  it('weekdays are normalised (all seven = every day); a subset is kept', async () => {
    const { rules, db } = makeServices();
    await rules.create(OWNER, {
      ...LADDER,
      steps: [LADDER.steps[0]!],
      weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    });
    expect(db.promotions[0]!.activeWeekdays).toBeNull();

    await rules.create(OWNER, { ...LADDER, steps: [LADDER.steps[0]!], weekdays: ['Sun', 'Mon'] });
    expect(db.promotions[1]!.activeWeekdays).toEqual(['Mon', 'Sun']);
  });

  it('no property can take the rule: nothing is created', async () => {
    const { rules, db } = makeServices();
    await expect(rules.create(OWNER, { ...LADDER, propertyIds: ['c'] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(rules.create(STRANGER, LADDER)).rejects.toBeInstanceOf(BadRequestException);
    expect(db.promotions).toHaveLength(0);
  });

  it('a chosen subset of properties is respected', async () => {
    const { rules, db } = makeServices();
    await rules.create(OWNER, { ...LADDER, steps: [LADDER.steps[0]!], propertyIds: ['b'] });
    expect(db.targets.map((t) => t.propertyId)).toEqual(['b']);
  });

  it('editing creates the new rule first, then switches the old one off', async () => {
    const { rules, db } = makeServices();
    const old = await rules.create(OWNER, LADDER);
    const next = await rules.create(OWNER, {
      ...LADDER,
      name: 'Горящие 2',
      steps: [{ discountPct: 7, unit: 'day', value: 2 }],
      replaceGroupId: old.groupId,
    });

    expect(next.groupId).not.toBe(old.groupId);
    const list = await rules.list(OWNER);
    expect(list.find((r) => r.groupId === next.groupId)).toMatchObject({ status: 'active' });
    expect(list.find((r) => r.groupId === old.groupId)).toMatchObject({ status: 'off' });
    const oldPromos = db.promotions.filter((p) => (p.externalMeta as { rule: { groupId: string } }).rule.groupId === old.groupId);
    expect(oldPromos.every((p) => p.status === 'off')).toBe(true);
    const oldTargets = db.targets.filter((t) => oldPromos.some((p) => p.id === t.promotionId));
    expect(oldTargets.every((t) => t.desiredState === 'off' && t.needsPush)).toBe(true);
  });

  it('editing: a failed switch-off of the old rule is reported, the new rule stays', async () => {
    const { rules, pricing } = makeServices();
    const old = await rules.create(OWNER, LADDER);
    jest.spyOn(pricing, 'setPromotionActive').mockRejectedValue(new Error('db down'));

    const next = await rules.create(OWNER, { ...LADDER, steps: [LADDER.steps[0]!], replaceGroupId: old.groupId });

    expect(next.warnings).toHaveLength(3);
    expect(next.warnings[0]).toContain('За 3 дня до заезда');
    expect(next.status).toBe('active');
  });

  it('a normal create has no warnings; a whole-day booking window is stored as «no restriction»', async () => {
    const { rules, db } = makeServices();
    const view = await rules.create(OWNER, {
      ...LADDER,
      steps: [{ discountPct: 5, unit: 'hour', value: 12, bookTime: { start: 0, end: 24 } }],
    });
    expect(view.warnings).toEqual([]);
    expect((db.promotions[0]!.externalMeta as { bookTime: unknown }).bookTime).toBeNull();
    expect(db.promotions[0]!.name).toBe('За 12 часов до заезда');
  });

  it('a step whose Booking copy differs from what was sent is flagged in the rule view', async () => {
    const { rules, db } = makeServices();
    const { groupId } = await rules.create(OWNER, { ...LADDER, steps: [LADDER.steps[0]!, LADDER.steps[1]!] });
    db.targets
      .filter((t) => t.promotionId === db.promotions[0]!.id && t.propertyId === 'a')
      .forEach((t) => Object.assign(t, { state: 'on', verifyNote: 'MISMATCH: Booking не вернул часы бронирования' }));

    const view = (await rules.list(OWNER)).find((r) => r.groupId === groupId)!;
    expect(view.steps.map((s) => s.mismatch)).toEqual([1, 0]);
  });

  it('the ordinary discount list leaves rule steps out; the property card still gets them', async () => {
    const { rules, pricing, db } = makeServices();
    await rules.create(OWNER, LADDER);
    db.promotions.push({
      id: 'plain',
      ownerId: 'owner-1',
      source: 'rentai',
      promotionType: 'basic',
      name: 'Обычная',
      discountPct: 10,
      status: 'active',
      stayFrom: '2030-01-01',
      stayTo: '2030-01-07',
      externalMeta: null,
      createdAt: new Date(),
    });
    db.targets.push({ id: 'tp', promotionId: 'plain', propertyId: 'a', desiredState: 'on', state: 'on', previousExternalIds: [] });

    expect((await pricing.list(OWNER)).map((p) => p.name)).toEqual(['Обычная']);
    expect((await pricing.list(OWNER, 'a')).length).toBe(4);
  });

  it('turning a property on / off changes only the steps where it is not already so', async () => {
    const { rules, db, queue } = makeServices();
    const { groupId } = await rules.create(OWNER, { ...LADDER, steps: [LADDER.steps[0]!, LADDER.steps[1]!] });
    const events = db.events.length;
    queue.kick.mockClear();

    await rules.setPropertyActive(OWNER, groupId, 'a', true); // already on everywhere
    expect(db.events).toHaveLength(events);
    expect(queue.kick).not.toHaveBeenCalled();

    await rules.setPropertyActive(OWNER, groupId, 'a', false);
    expect(db.events.length).toBe(events + 2);
  });

  it('editing an unknown rule fails before anything is created', async () => {
    const { rules, db } = makeServices();
    await expect(
      rules.create(OWNER, { ...LADDER, replaceGroupId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.promotions).toHaveLength(0);
  });

  it('list: only this tenant\'s auto-rule steps; ordinary discounts are not rules', async () => {
    const { rules, db } = makeServices();
    await rules.create(OWNER, LADDER);
    db.promotions.push({
      id: 'plain',
      ownerId: 'owner-1',
      source: 'rentai',
      promotionType: 'basic',
      name: 'Обычная',
      discountPct: 10,
      status: 'active',
      externalMeta: null,
      createdAt: new Date(),
    });
    db.promotions.push({
      id: 'extranet',
      ownerId: 'owner-1',
      source: 'booking',
      promotionType: 'last_minute',
      name: 'Из экстранета',
      discountPct: 20,
      status: 'active',
      externalMeta: { lastMinute: { unit: 'day', value: 2 } },
      createdAt: new Date(),
    });

    expect(await rules.list(OWNER)).toHaveLength(1);
    expect(await rules.list(STRANGER)).toHaveLength(0);
  });

  it('switch the whole rule off and on again; a manual «off» of one property is not lost on resend', async () => {
    const { rules, db } = makeServices();
    const { groupId } = await rules.create(OWNER, LADDER);

    const off = await rules.setActive(OWNER, groupId, false);
    expect(off.status).toBe('off');
    expect(db.targets.every((t) => t.desiredState === 'off')).toBe(true);

    const on = await rules.setActive(OWNER, groupId, true);
    expect(on.status).toBe('active');
    expect(db.targets.every((t) => t.desiredState === 'on' && t.state === 'pending')).toBe(true);

    await expect(rules.setActive(OWNER, '00000000-0000-4000-8000-000000000000', false)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('one property can be switched off for the whole rule (every step) and on again', async () => {
    const { rules, db } = makeServices();
    const { groupId } = await rules.create(OWNER, LADDER);

    const off = await rules.setPropertyActive(OWNER, groupId, 'a', false);
    expect(db.targets.filter((t) => t.propertyId === 'a').every((t) => t.desiredState === 'off' && t.needsPush)).toBe(true);
    expect(db.targets.filter((t) => t.propertyId === 'b').every((t) => t.desiredState === 'on')).toBe(true);
    expect(off.properties.find((p) => p.propertyId === 'a')!.state).toBe('off');
    expect(off.status).toBe('active');

    const on = await rules.setPropertyActive(OWNER, groupId, 'a', true);
    expect(db.targets.filter((t) => t.propertyId === 'a').every((t) => t.desiredState === 'on' && t.state === 'pending')).toBe(true);
    expect(on.properties.find((p) => p.propertyId === 'a')!.state).toBe('pending');

    await expect(rules.setPropertyActive(OWNER, groupId, 'c', false)).rejects.toBeInstanceOf(NotFoundException);
    await expect(rules.setPropertyActive(OWNER, '00000000-0000-4000-8000-000000000000', 'a', false)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('turning one property on does not revive a step that was switched off as a whole', async () => {
    const { rules, db } = makeServices();
    const { groupId } = await rules.create(OWNER, { ...LADDER, steps: [LADDER.steps[0]!, LADDER.steps[1]!] });
    const [s0, s1] = db.promotions.map((p) => p.id);
    await rules.setPropertyActive(OWNER, groupId, 'a', false);
    db.promotions.find((p) => p.id === s1)!.status = 'off';

    await rules.setPropertyActive(OWNER, groupId, 'a', true);

    const t = (promotionId: unknown) => db.targets.find((x) => x.promotionId === promotionId && x.propertyId === 'a')!;
    expect(t(s0).desiredState).toBe('on');
    expect(t(s1).desiredState).toBe('off');
  });

  it('resend: test-mode / failed / skipped targets go back to the queue, live and manually-off ones stay', async () => {
    const { rules, db, queue } = makeServices();
    const { groupId } = await rules.create(OWNER, { ...LADDER, steps: [LADDER.steps[0]!, LADDER.steps[1]!] });
    // step 0: a = dry_run, b = on; step 1: a = error, b = off by hand
    const [s0, s1] = db.promotions.map((p) => p.id);
    const t = (promotionId: unknown, propertyId: string) =>
      db.targets.find((x) => x.promotionId === promotionId && x.propertyId === propertyId)!;
    Object.assign(t(s0, 'a'), { state: 'dry_run', needsPush: false });
    Object.assign(t(s0, 'b'), { state: 'on', needsPush: false });
    Object.assign(t(s1, 'a'), { state: 'error', needsPush: false, attempts: 6 });
    Object.assign(t(s1, 'b'), { state: 'off', desiredState: 'off', needsPush: false });
    queue.kick.mockClear();

    const view = await rules.resend(OWNER, groupId);

    expect(t(s0, 'a')).toMatchObject({ state: 'pending', needsPush: true });
    expect(t(s1, 'a')).toMatchObject({ state: 'pending', needsPush: true, attempts: 0 });
    expect(t(s0, 'b')).toMatchObject({ state: 'on', needsPush: false });
    expect(t(s1, 'b')).toMatchObject({ state: 'off', desiredState: 'off', needsPush: false });
    expect(queue.kick).toHaveBeenCalledTimes(1);
    expect(view.counts.pending).toBe(2);
  });

  it('resend with nothing to send does not wake the queue', async () => {
    const { rules, db, queue } = makeServices();
    const { groupId } = await rules.create(OWNER, { ...LADDER, steps: [LADDER.steps[0]!] });
    db.targets.forEach((t) => Object.assign(t, { state: 'on', needsPush: false }));
    queue.kick.mockClear();
    await rules.resend(OWNER, groupId);
    expect(queue.kick).not.toHaveBeenCalled();
  });
});

describe('createRuleSchema', () => {
  const ok = { name: 'R', steps: [{ discountPct: 5, unit: 'day', value: 3 }] };

  it('accepts a ladder and defaults the horizon to 6 months', () => {
    const parsed = createRuleSchema.parse(ok);
    expect(parsed.horizonMonths).toBe(6);
  });

  it.each([
    ['discount 0', { ...ok, steps: [{ discountPct: 0, unit: 'day', value: 3 }] }],
    ['discount 100', { ...ok, steps: [{ discountPct: 100, unit: 'day', value: 3 }] }],
    ['unknown unit', { ...ok, steps: [{ discountPct: 5, unit: 'week', value: 3 }] }],
    ['more than 30 days', { ...ok, steps: [{ discountPct: 5, unit: 'day', value: 31 }] }],
    ['more than 720 hours', { ...ok, steps: [{ discountPct: 5, unit: 'hour', value: 721 }] }],
    ['book time start ≥ end', { ...ok, steps: [{ discountPct: 5, unit: 'hour', value: 5, bookTime: { start: 12, end: 12 } }] }],
    ['no steps', { ...ok, steps: [] }],
    ['9 steps', { ...ok, steps: Array.from({ length: 9 }, (_, i) => ({ discountPct: 5, unit: 'day', value: i + 1 })) }],
    ['duplicate steps', { ...ok, steps: [{ discountPct: 5, unit: 'day', value: 3 }, { discountPct: 9, unit: 'day', value: 3 }] }],
    ['empty name', { ...ok, name: '  ' }],
    ['horizon 13 months', { ...ok, horizonMonths: 13 }],
    ['unknown field', { ...ok, extra: 1 }],
    ['the same property twice', { ...ok, propertyIds: ['11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'] }],
  ])('rejects %s', (_label, body) => {
    expect(createRuleSchema.safeParse(body).success).toBe(false);
  });

  it('the same window with a different time of day is a different step', () => {
    const res = createRuleSchema.safeParse({
      ...ok,
      steps: [
        { discountPct: 10, unit: 'hour', value: 12, bookTime: { start: 6, end: 12 } },
        { discountPct: 12, unit: 'hour', value: 12, bookTime: { start: 12, end: 18 } },
      ],
    });
    expect(res.success).toBe(true);
  });
});

describe('calendar and booking-time windows', () => {
  afterEach(() => jest.useRealTimers());

  it('a step limited to hours of the day is shown on the calendar only while it applies (property time)', async () => {
    const { rules, pricing } = makeServices();
    jest.useFakeTimers({ now: new Date('2026-10-05T08:00:00Z') }); // 10:00 in Warsaw
    await rules.create(OWNER, {
      name: 'Утро',
      horizonMonths: 6,
      steps: [{ discountPct: 10, unit: 'hour', value: 12, bookTime: { start: 6, end: 12 } }],
    });
    const window = () => pricing.calendar(OWNER, '2026-10-05', addDaysYmd('2026-10-05', 3));

    expect((await window()).map((p) => p.properties.length)).toEqual([2]);

    jest.setSystemTime(new Date('2026-10-05T13:00:00Z')); // 15:00 in Warsaw
    expect(await window()).toEqual([]);
  });
});
