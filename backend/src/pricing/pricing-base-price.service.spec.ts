import { In } from 'typeorm';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import type { DataSource, Repository } from 'typeorm';
import { PricingConfig } from './pricing-config';
import { BASE_PRICE_MAX_RANGE_DAYS, PricingBasePriceService, targetsFingerprint } from './pricing-base-price.service';
import { basePriceRangeSchema, bookingSendConfirmSchema, channelPricingSchema } from './dto/pricing-base-price.dto';
import { addDaysYmd } from './pricing-math.util';
import type { PricingService } from './pricing.service';
import type { PromotionSyncService } from './promotion-sync.service';
import type { PropertyService } from '../property/property.service';
import type { CalendarDatesService } from '../calendar-dates/calendar-dates.service';
import type { PropertyBasePriceEntity } from './entities/property-base-price.entity';
import type { PropertyChannelPricingEntity } from './entities/property-channel-pricing.entity';
import type { PropertyChannelNightPriceEntity } from './entities/property-channel-night-price.entity';
import type { PropertyAutoPriceEntity } from './entities/pricing-auto-price.entity';
import type { JwtPayload } from '../common/decorators/current-user.decorator';

const OWNER: JwtPayload = { sub: 'u1', email: 'anna@example.com', role: 'OWNER' };
const PROP = 'p1';
const EXT = '11021398';
const ANY_PRINT = 'a'.repeat(40);

function setup(
  opts: {
    env?: Record<string, unknown>;
    base?: Array<{ date: string; priceMinor: number }>;
    typed?: Array<{ date: string; priceMinor: number; channel?: string }>;
    rules?: Array<Partial<PropertyChannelPricingEntity>>;
    datesEnabled?: boolean;
    ext?: string | null;
    /** What Booking has open: night → price of the main rate. */
    open?: Record<string, number>;
    /** «Автоцены»: night → percent the rule put on. */
    auto?: Record<string, number>;
    minPrice?: number | null;
  } = {},
) {
  const values: Record<string, unknown> = {
    ZODOMUS_ENABLED: true,
    ZODOMUS_PROMOTIONS_ENABLED: true,
    ZODOMUS_PROMOTIONS_GUEST_PRICE_ENABLED: true,
    ZODOMUS_PROMOTIONS_BASE_PRICE_ENABLED: true,
    ZODOMUS_PROMOTIONS_DRY_RUN: false,
    ZODOMUS_PROMOTIONS_PROPERTY_ALLOWLIST: EXT,
    ...opts.env,
  };
  const cfg = new PricingConfig({ get: (k: string) => values[k] } as unknown as ConfigService);
  const pricing = {
    assertEnabled: jest.fn(() => {
      if (!cfg.flags.enabled) throw new ServiceUnavailableException('off');
    }),
  };
  const sync = { externalIdOf: jest.fn(() => (opts.ext === undefined ? EXT : opts.ext)) };
  const propertyService = {
    findOneForUser: jest.fn(async (id: string) => {
      if (id !== PROP) throw new NotFoundException('Property not found');
      return { id, timezone: 'Europe/Warsaw' };
    }),
  };
  const dates = {
    enabled: opts.datesEnabled ?? true,
    previewPrices: jest.fn(async (_u: unknown, _p: string, t: Map<string, number>) => ({ action: 'price', targets: [...t] })),
    startPrices: jest.fn(async (_u: unknown, _p: string, t: Map<string, number>) => ({ action: 'price', state: 'running', targets: [...t] })),
    readOpenRatePrices: jest.fn(async () => new Map(Object.entries(opts.open ?? {}))),
    minPriceOf: jest.fn(async () => opts.minPrice ?? null),
  };
  const inRange = (date: string, where: { date?: { _value?: [string, string] } }) => {
    const v = where.date?._value;
    return !v || (date >= v[0] && date <= v[1]);
  };
  const baseRepo = {
    find: jest.fn(async ({ where }: { where: { date?: { _value?: [string, string] } } }) =>
      (opts.base ?? []).filter((b) => inRange(b.date, where)),
    ),
    upsert: jest.fn(async () => undefined),
    inserted: [] as unknown[],
    createQueryBuilder: jest.fn(),
  };
  type Qb = {
    insert: () => Qb;
    into: () => Qb;
    values: (v: unknown[]) => Qb;
    orIgnore: jest.Mock<Qb, []>;
    execute: jest.Mock<Promise<{ raw: unknown[] }>, []>;
  };
  const qb: Qb = {
    insert: () => qb,
    into: () => qb,
    values: (v: unknown[]) => ((baseRepo.inserted = v), qb),
    orIgnore: jest.fn(() => qb),
    execute: jest.fn(async () => ({ raw: [] })),
  };
  baseRepo.createQueryBuilder.mockReturnValue(qb);
  let rules = (opts.rules ?? []).map((r) => ({ ...r })) as PropertyChannelPricingEntity[];
  const channelRepo = {
    find: jest.fn(async () => rules),
    findOne: jest.fn(async ({ where }: { where: { channel: string } }) => rules.find((r) => r.channel === where.channel) ?? null),
    upsert: jest.fn(async (r: PropertyChannelPricingEntity) => {
      const cur = rules.find((x) => x.channel === r.channel);
      if (cur) Object.assign(cur, r);
      else rules = [...rules, { ...{ markupPct: 0, singleGuestPct: null, extraGuestPct: null }, ...r } as PropertyChannelPricingEntity];
    }),
  };
  const nightPriceRepo = {
    find: jest.fn(async ({ where }: { where: { channel: string; date?: { _value?: [string, string] } } }) =>
      (opts.typed ?? []).filter((t) => (t.channel ?? 'booking') === where.channel && inRange(t.date, where)),
    ),
  };
  const autoRepo = {
    find: jest.fn(async ({ where }: { where: { date?: { _value?: [string, string] } } }) =>
      Object.entries(opts.auto ?? {})
        .map(([date, pct]) => ({ propertyId: PROP, date, pct }))
        .filter((a) => inRange(a.date, where)),
    ),
  };
  const tx = { delete: jest.fn(async () => undefined), insert: jest.fn(async () => undefined) };
  const dataSource = {
    transaction: jest.fn(async (work: (m: { getRepository: () => typeof tx }) => Promise<void>) => work({ getRepository: () => tx })),
  };
  const svc = new PricingBasePriceService(
    cfg,
    pricing as unknown as PricingService,
    sync as unknown as PromotionSyncService,
    propertyService as unknown as PropertyService,
    dates as unknown as CalendarDatesService,
    dataSource as unknown as DataSource,
    baseRepo as unknown as Repository<PropertyBasePriceEntity>,
    channelRepo as unknown as Repository<PropertyChannelPricingEntity>,
    nightPriceRepo as unknown as Repository<PropertyChannelNightPriceEntity>,
    autoRepo as unknown as Repository<PropertyAutoPriceEntity>,
  );
  return { svc, baseRepo, qb, channelRepo, nightPriceRepo, dates, tx, dataSource, sync, autoRepo };
}

const NOV = { from: '2026-11-01', to: '2026-11-04' };

beforeEach(() => {
  jest.useFakeTimers({
    now: new Date('2026-10-23T10:00:00Z'),
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'],
  });
});
afterEach(() => jest.useRealTimers());

describe('PricingBasePriceService — switches', () => {
  it('answers 503 while the flag is off and never touches the tables or Booking', async () => {
    const s = setup({ env: { ZODOMUS_PROMOTIONS_BASE_PRICE_ENABLED: false } });
    await expect(s.svc.overview(OWNER, PROP, NOV.from, NOV.to)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(s.svc.setRange(OWNER, PROP, { ...NOV, price: 500 })).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(s.svc.fillFromBooking(OWNER, PROP, NOV)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(s.svc.saveChannel(OWNER, PROP, 'booking', { markupPct: 10 })).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(s.svc.previewBooking(OWNER, PROP, NOV)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(s.svc.sendBooking(OWNER, PROP, { ...NOV, fingerprint: ANY_PRINT })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(s.baseRepo.find).not.toHaveBeenCalled();
    expect(s.channelRepo.upsert).not.toHaveBeenCalled();
    expect(s.dataSource.transaction).not.toHaveBeenCalled();
    expect(s.dates.previewPrices).not.toHaveBeenCalled();
    expect(s.dates.startPrices).not.toHaveBeenCalled();
    expect(s.dates.readOpenRatePrices).not.toHaveBeenCalled();
  });

  it('needs promotions to be enabled as well', async () => {
    const s = setup({ env: { ZODOMUS_PROMOTIONS_ENABLED: false } });
    await expect(s.svc.overview(OWNER, PROP, NOV.from, NOV.to)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('needs «Цена для гостя» switched on as well (it builds on it)', async () => {
    const s = setup({ env: { ZODOMUS_PROMOTIONS_GUEST_PRICE_ENABLED: false } });
    await expect(s.svc.overview(OWNER, PROP, NOV.from, NOV.to)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('flag on before the migration: a clear 503 naming the migration', async () => {
    const s = setup();
    s.baseRepo.find.mockRejectedValue(
      new QueryFailedError('SELECT', [], Object.assign(new Error('relation does not exist'), { code: '42P01' })),
    );
    const err = await s.svc.overview(OWNER, PROP, NOV.from, NOV.to).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as Error).message).toContain('1778700000000-pricing-base-price');
  });

  it('someone else’s property: 404, nothing read, nothing sent', async () => {
    const s = setup();
    await expect(s.svc.overview(OWNER, 'other', NOV.from, NOV.to)).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.svc.sendBooking(OWNER, 'other', { ...NOV, fingerprint: ANY_PRINT })).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.svc.fillFromBooking(OWNER, 'other', NOV)).rejects.toBeInstanceOf(NotFoundException);
    expect(s.baseRepo.find).not.toHaveBeenCalled();
    expect(s.dates.startPrices).not.toHaveBeenCalled();
    expect(s.dates.readOpenRatePrices).not.toHaveBeenCalled();
  });

  it.each([
    ['not a date', '2026-11-01', '1.11.2026'],
    ['a date that does not exist', '2026-02-27', '2026-02-30'],
    ['from after to', '2026-11-04', '2026-11-01'],
    ['longer than a year', '2026-11-01', addDaysYmd('2026-11-01', BASE_PRICE_MAX_RANGE_DAYS)],
  ])('refuses a bad range: %s', async (_n, from, to) => {
    const s = setup();
    await expect(s.svc.overview(OWNER, PROP, from, to)).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.svc.sendBooking(OWNER, PROP, { from, to, fingerprint: ANY_PRINT })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PricingBasePriceService — overview and editing', () => {
  it('base prices in major units; channels default to markup 0', async () => {
    const s = setup({ base: [{ date: '2026-11-01', priceMinor: 50000 }, { date: '2026-12-01', priceMinor: 1 }] });
    const o = await s.svc.overview(OWNER, PROP, NOV.from, NOV.to);
    expect(o.base).toEqual({ '2026-11-01': 500 });
    expect(o.channels.booking).toEqual({ channel: 'booking', markupPct: 0, singleGuestPct: null, extraGuestPct: null, isDefault: true });
    expect(o.bookingSend).toBeNull();
  });

  it.each([
    ['DATES_OFF', { datesEnabled: false }],
    ['NOT_ON_BOOKING', { ext: null }],
    ['NOT_IN_PILOT', { env: { ZODOMUS_PROMOTIONS_PROPERTY_ALLOWLIST: 'someone-else' } }],
    // unlike promotions, an empty pilot list lets nobody through
    ['NOT_IN_PILOT', { env: { ZODOMUS_PROMOTIONS_PROPERTY_ALLOWLIST: '' } }],
    ['DRY_RUN', { env: { ZODOMUS_PROMOTIONS_DRY_RUN: true } }],
  ])('tells why Booking cannot be sent to: %s', async (reason, o) => {
    const s = setup(o as Parameters<typeof setup>[0]);
    expect((await s.svc.overview(OWNER, PROP, NOV.from, NOV.to)).bookingSend).toBe(reason);
  });

  it('a range: replaces every night; price null only removes', async () => {
    const s = setup();
    const out = await s.svc.setRange(OWNER, PROP, { from: '2026-11-01', to: '2026-11-03', price: 480 });
    expect(s.tx.delete).toHaveBeenCalledTimes(1);
    expect(s.tx.insert).toHaveBeenCalledWith([
      { propertyId: PROP, date: '2026-11-01', priceMinor: 48000 },
      { propertyId: PROP, date: '2026-11-02', priceMinor: 48000 },
      { propertyId: PROP, date: '2026-11-03', priceMinor: 48000 },
    ]);
    expect(out).toEqual({ '2026-11-01': 480, '2026-11-02': 480, '2026-11-03': 480 });
    s.tx.insert.mockClear();
    expect(await s.svc.setRange(OWNER, PROP, { from: '2026-11-01', to: '2026-11-03', price: null })).toEqual({});
    expect(s.tx.insert).not.toHaveBeenCalled();
  });

  it('a range with days of the week: only those nights are replaced or removed', async () => {
    const s = setup();
    // 2026-11-06 Fri, 07 Sat, 08 Sun, 09 Mon
    const out = await s.svc.setRange(OWNER, PROP, { from: '2026-11-06', to: '2026-11-09', price: 600, weekdays: [5, 6] });
    expect(s.tx.delete).toHaveBeenCalledWith({ propertyId: PROP, date: In(['2026-11-06', '2026-11-07']) });
    expect(s.tx.insert).toHaveBeenCalledWith([
      { propertyId: PROP, date: '2026-11-06', priceMinor: 60000 },
      { propertyId: PROP, date: '2026-11-07', priceMinor: 60000 },
    ]);
    expect(out).toEqual({ '2026-11-06': 600, '2026-11-07': 600 });
    s.tx.insert.mockClear();
    s.tx.delete.mockClear();
    expect(await s.svc.setRange(OWNER, PROP, { from: '2026-11-06', to: '2026-11-09', price: null, weekdays: [0] })).toEqual({});
    expect(s.tx.delete).toHaveBeenCalledWith({ propertyId: PROP, date: In(['2026-11-08']) });
    expect(s.tx.insert).not.toHaveBeenCalled();
    // all seven days = the whole range, as without the list
    s.tx.delete.mockClear();
    await s.svc.setRange(OWNER, PROP, { from: '2026-11-06', to: '2026-11-07', price: 500, weekdays: [0, 1, 2, 3, 4, 5, 6] });
    expect(s.tx.delete).toHaveBeenCalledWith({ propertyId: PROP, date: In(['2026-11-06', '2026-11-07']) });
  });

  it('a range with days of the week that are not in it: 400, nothing written', async () => {
    const s = setup();
    // 2026-11-02 Mon, 03 Tue — no Saturday
    await expect(
      s.svc.setRange(OWNER, PROP, { from: '2026-11-02', to: '2026-11-03', price: 500, weekdays: [6] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(s.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('days of the week in the request: 0–6, at least one, no more than seven', () => {
    const ok = basePriceRangeSchema.safeParse({ from: '2026-11-01', to: '2026-11-07', price: 500, weekdays: [0, 6] });
    expect(ok.success).toBe(true);
    for (const weekdays of [[], [7], [-1], [1.5], [0, 1, 2, 3, 4, 5, 6, 0]]) {
      expect(basePriceRangeSchema.safeParse({ from: '2026-11-01', to: '2026-11-07', price: 500, weekdays }).success).toBe(false);
    }
    expect(basePriceRangeSchema.safeParse({ from: '2026-11-01', to: '2026-11-07', price: 500 }).success).toBe(true);
  });

  it('channel rules: unknown channel 400; only sent fields written; null clears a guest percent', async () => {
    const s = setup();
    await expect(s.svc.saveChannel(OWNER, PROP, 'expedia', { markupPct: 5 })).rejects.toBeInstanceOf(BadRequestException);
    const v = await s.svc.saveChannel(OWNER, PROP, 'airbnb', { markupPct: -5, singleGuestPct: 10 });
    expect(s.channelRepo.upsert).toHaveBeenLastCalledWith(
      { propertyId: PROP, channel: 'airbnb', markupPct: -5, singleGuestPct: 10 },
      ['propertyId', 'channel'],
    );
    expect(v).toMatchObject({ markupPct: -5, singleGuestPct: 10, isDefault: false });
    await s.svc.saveChannel(OWNER, PROP, 'airbnb', { singleGuestPct: null });
    expect(s.channelRepo.upsert).toHaveBeenLastCalledWith({ propertyId: PROP, channel: 'airbnb', singleGuestPct: null }, ['propertyId', 'channel']);
  });
});

describe('PricingBasePriceService — «Заполнить из Booking»', () => {
  it('only open nights of the main rate, only nights without a base price; reads Booking through the dates run', async () => {
    const s = setup({
      base: [{ date: '2026-11-02', priceMinor: 45000 }],
      open: { '2026-11-01': 284, '2026-11-02': 290, '2026-11-04': 89.9 },
    });
    const r = await s.svc.fillFromBooking(OWNER, PROP, NOV);
    expect(s.dates.readOpenRatePrices).toHaveBeenCalledWith(OWNER, PROP, '2026-11-01', '2026-11-05');
    expect(s.baseRepo.inserted).toEqual([
      { propertyId: PROP, date: '2026-11-01', priceMinor: 28400 },
      { propertyId: PROP, date: '2026-11-04', priceMinor: 8990 },
    ]);
    // a base saved meanwhile is never overwritten
    expect(s.qb.orIgnore).toHaveBeenCalled();
    expect(s.baseRepo.upsert).not.toHaveBeenCalled();
    // 4 nights: 2 filled, 1 kept (had a base), 1 not open (11-03 closed or sold)
    expect(r).toEqual({ filled: 2, kept: 1, notOpen: 1 });
  });

  it('nothing open → nothing written', async () => {
    const s = setup({ open: {} });
    expect(await s.svc.fillFromBooking(OWNER, PROP, NOV)).toEqual({ filled: 0, kept: 0, notOpen: 4 });
    expect(s.qb.execute).not.toHaveBeenCalled();
  });

  it('past nights do not count as «not open»', async () => {
    const s = setup({ open: { '2026-10-23': 300 } });
    const r = await s.svc.fillFromBooking(OWNER, PROP, { from: '2026-10-01', to: '2026-10-24' });
    expect(r).toEqual({ filled: 1, kept: 0, notOpen: 1 });
  });
});

describe('PricingBasePriceService — Booking prices', () => {
  const base = [
    { date: '2026-11-01', priceMinor: 50000 },
    { date: '2026-11-02', priceMinor: 50000 },
    { date: '2026-11-03', priceMinor: 28400 },
  ];
  const targetsOf = (calls: unknown[][]) => [...(calls[0]![2] as Map<string, number>)];

  it('preview: base × Booking markup (whole zł), a typed Booking price wins, Airbnb prices are ignored; a fingerprint comes back', async () => {
    const s = setup({
      base,
      rules: [{ propertyId: PROP, channel: 'booking', markupPct: 10 }, { propertyId: PROP, channel: 'airbnb', markupPct: -50 }],
      typed: [
        { date: '2026-11-02', priceMinor: 45000 },
        { date: '2026-11-03', priceMinor: 99900, channel: 'airbnb' },
      ],
    });
    const p = await s.svc.previewBooking(OWNER, PROP, NOV);
    const expected = new Map([['2026-11-01', 550], ['2026-11-02', 450], ['2026-11-03', 312]]);
    expect(targetsOf(s.dates.previewPrices.mock.calls)).toEqual([...expected]);
    expect(p.fingerprint).toBe(targetsFingerprint(expected));
  });

  it('preview works in test mode and outside the pilot (it only reads)', async () => {
    const s = setup({ base, env: { ZODOMUS_PROMOTIONS_DRY_RUN: true, ZODOMUS_PROMOTIONS_PROPERTY_ALLOWLIST: '' } });
    await expect(s.svc.previewBooking(OWNER, PROP, NOV)).resolves.toBeDefined();
  });

  it('no base price and no typed price for the nights → 400, Booking not asked', async () => {
    const s = setup();
    await expect(s.svc.previewBooking(OWNER, PROP, NOV)).rejects.toThrow('нет базовой цены');
    await expect(s.svc.sendBooking(OWNER, PROP, { ...NOV, fingerprint: ANY_PRINT })).rejects.toThrow('нет базовой цены');
    expect(s.dates.previewPrices).not.toHaveBeenCalled();
    expect(s.dates.startPrices).not.toHaveBeenCalled();
  });

  it('send with the preview’s fingerprint goes through the dates run with the same targets', async () => {
    const s = setup({ base });
    const p = await s.svc.previewBooking(OWNER, PROP, NOV);
    await s.svc.sendBooking(OWNER, PROP, { ...NOV, fingerprint: p.fingerprint });
    expect(targetsOf(s.dates.startPrices.mock.calls)).toEqual([
      ['2026-11-01', 500],
      ['2026-11-02', 500],
      ['2026-11-03', 284],
    ]);
  });

  it('prices changed after the preview (markup, typed price, base) → 409, nothing sent', async () => {
    const s = setup({ base });
    const p = await s.svc.previewBooking(OWNER, PROP, NOV);
    await s.svc.saveChannel(OWNER, PROP, 'booking', { markupPct: 50 });
    await expect(s.svc.sendBooking(OWNER, PROP, { ...NOV, fingerprint: p.fingerprint })).rejects.toBeInstanceOf(ConflictException);
    expect(s.dates.startPrices).not.toHaveBeenCalled();
  });

  it.each([
    ['test mode', { env: { ZODOMUS_PROMOTIONS_DRY_RUN: true } }, 'тестовый режим'],
    ['outside the pilot', { env: { ZODOMUS_PROMOTIONS_PROPERTY_ALLOWLIST: 'x' } }, 'списке пилота'],
    ['with an empty pilot list', { env: { ZODOMUS_PROMOTIONS_PROPERTY_ALLOWLIST: '' } }, 'списке пилота'],
    ['not on Booking', { ext: null }, 'не подключён'],
    ['dates tool off', { datesEnabled: false }, 'ZODOMUS_CALENDAR_DATES_ENABLED'],
  ])('send is refused %s — nothing reaches Booking', async (_n, o, msg) => {
    const s = setup({ base, ...(o as object) });
    await expect(s.svc.sendBooking(OWNER, PROP, { ...NOV, fingerprint: ANY_PRINT })).rejects.toThrow(msg);
    expect(s.dates.startPrices).not.toHaveBeenCalled();
  });
});

describe('PricingBasePriceService — «Автоцены» on the Booking price', () => {
  const base = [
    { date: '2026-11-01', priceMinor: 50000 },
    { date: '2026-11-02', priceMinor: 50000 },
    { date: '2026-11-03', priceMinor: 28400 },
  ];
  const AUTO_ON = { ZODOMUS_PROMOTIONS_AUTOPRICE_ENABLED: true, ZODOMUS_PROMOTIONS_AUTOPRICE_DRY_RUN: false };
  const targetsOf = (calls: unknown[][]) => [...(calls[0]![2] as Map<string, number>)];

  it('flag on: base × (100 + pct) % (whole units), then the markup; nights without a percent as they were', async () => {
    const s = setup({
      base,
      env: AUTO_ON,
      rules: [{ propertyId: PROP, channel: 'booking', markupPct: 10 }],
      auto: { '2026-11-01': -10, '2026-11-03': 5 },
    });
    await s.svc.previewBooking(OWNER, PROP, NOV);
    // 500 −10 % = 450 → +10 % = 495; 284 +5 % = 298 → +10 % = 328 (whole zł)
    expect(targetsOf(s.dates.previewPrices.mock.calls)).toEqual([
      ['2026-11-01', 495],
      ['2026-11-02', 550],
      ['2026-11-03', 328],
    ]);
  });

  it('a Booking price typed by hand wins over the rule', async () => {
    const s = setup({ base, env: AUTO_ON, typed: [{ date: '2026-11-01', priceMinor: 61000 }], auto: { '2026-11-01': -10 } });
    await s.svc.previewBooking(OWNER, PROP, NOV);
    expect(targetsOf(s.dates.previewPrices.mock.calls)[0]).toEqual(['2026-11-01', 610]);
  });

  it('never below the minimum price', async () => {
    const s = setup({ base, env: AUTO_ON, auto: { '2026-11-03': -20 }, minPrice: 260 });
    await s.svc.previewBooking(OWNER, PROP, NOV);
    // 284 −20 % = 227 < 260
    expect(targetsOf(s.dates.previewPrices.mock.calls)[2]).toEqual(['2026-11-03', 260]);
  });

  it('a percent on a night without a base price adds no night', async () => {
    const s = setup({ base, env: AUTO_ON, auto: { '2026-11-04': -10 } });
    await s.svc.previewBooking(OWNER, PROP, NOV);
    expect(targetsOf(s.dates.previewPrices.mock.calls).map(([d]) => d)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
  });

  it('flag off: stored percents are not read and change nothing', async () => {
    const s = setup({ base, auto: { '2026-11-01': -10 } });
    await s.svc.previewBooking(OWNER, PROP, NOV);
    expect(targetsOf(s.dates.previewPrices.mock.calls)[0]).toEqual(['2026-11-01', 500]);
    expect(s.autoRepo.find).not.toHaveBeenCalled();
  });

  it('«Только показывать» or Booking writes paused: stored percents rest, the base price applies', async () => {
    for (const env of [{ ZODOMUS_PROMOTIONS_AUTOPRICE_DRY_RUN: true }, { ZODOMUS_PROMOTIONS_DRY_RUN: true }]) {
      const s = setup({ base, env: { ...AUTO_ON, ...env }, auto: { '2026-11-01': -10 } });
      await s.svc.previewBooking(OWNER, PROP, NOV);
      expect(targetsOf(s.dates.previewPrices.mock.calls)[0]).toEqual(['2026-11-01', 500]);
    }
  });

  it('the percents passed in replace the stored ones (the run sends before it stores)', async () => {
    const s = setup({ base, env: AUTO_ON, auto: { '2026-11-01': -10 } });
    const t = await s.svc.bookingTargets(PROP, '2026-11-01', '2026-11-03', new Map([['2026-11-02', 5], ['2026-12-01', 5]]));
    expect([...t]).toEqual([['2026-11-01', 500], ['2026-11-02', 525], ['2026-11-03', 284]]);
  });

  it('table missing (migration not run): the base price as it is, no error', async () => {
    const s = setup({ base, env: AUTO_ON });
    s.autoRepo.find.mockRejectedValueOnce(new Error('relation "property_auto_prices" does not exist'));
    await s.svc.previewBooking(OWNER, PROP, NOV);
    expect(targetsOf(s.dates.previewPrices.mock.calls)[0]).toEqual(['2026-11-01', 500]);
  });
});

describe('targetsFingerprint', () => {
  it('same nights and prices → same print, in any order; any change → another', () => {
    const a = targetsFingerprint(new Map([['2026-11-01', 500], ['2026-11-02', 520]]));
    expect(targetsFingerprint(new Map([['2026-11-02', 520], ['2026-11-01', 500]]))).toBe(a);
    expect(targetsFingerprint(new Map([['2026-11-01', 500], ['2026-11-02', 521]]))).not.toBe(a);
    expect(targetsFingerprint(new Map([['2026-11-01', 500]]))).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('base price DTOs', () => {
  it('range: real dates, from ≤ to, a positive price or null', () => {
    expect(basePriceRangeSchema.safeParse({ from: '2026-11-01', to: '2026-11-01', price: 500 }).success).toBe(true);
    expect(basePriceRangeSchema.safeParse({ from: '2026-11-01', to: '2026-11-01', price: null }).success).toBe(true);
    expect(basePriceRangeSchema.safeParse({ from: '2026-02-30', to: '2026-03-01', price: 500 }).success).toBe(false);
    expect(basePriceRangeSchema.safeParse({ from: '2026-11-02', to: '2026-11-01', price: 500 }).success).toBe(false);
    expect(basePriceRangeSchema.safeParse({ from: '2026-11-01', to: '2026-11-01', price: 0 }).success).toBe(false);
    expect(basePriceRangeSchema.safeParse({ from: '2026-11-01', to: '2026-11-01', price: 500, extra: 1 }).success).toBe(false);
  });

  it('send: the preview fingerprint is required', () => {
    expect(bookingSendConfirmSchema.safeParse({ ...NOV, fingerprint: ANY_PRINT }).success).toBe(true);
    expect(bookingSendConfirmSchema.safeParse(NOV).success).toBe(false);
    expect(bookingSendConfirmSchema.safeParse({ ...NOV, fingerprint: 'nope' }).success).toBe(false);
  });

  it('channel rules: markup −50…200 whole %, guest percents bounded', () => {
    expect(channelPricingSchema.safeParse({ markupPct: -50 }).success).toBe(true);
    expect(channelPricingSchema.safeParse({ markupPct: 200 }).success).toBe(true);
    expect(channelPricingSchema.safeParse({ markupPct: -51 }).success).toBe(false);
    expect(channelPricingSchema.safeParse({ markupPct: 201 }).success).toBe(false);
    expect(channelPricingSchema.safeParse({ markupPct: 10.5 }).success).toBe(false);
    expect(channelPricingSchema.safeParse({ singleGuestPct: 91 }).success).toBe(false);
    expect(channelPricingSchema.safeParse({ extraGuestPct: null }).success).toBe(true);
  });
});
