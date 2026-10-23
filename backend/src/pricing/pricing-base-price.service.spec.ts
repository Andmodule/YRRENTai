import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import type { DataSource, Repository } from 'typeorm';
import { PricingConfig } from './pricing-config';
import { BASE_PRICE_MAX_RANGE_DAYS, PricingBasePriceService } from './pricing-base-price.service';
import { basePriceNightsSchema, basePriceRangeSchema, channelPricingSchema } from './dto/pricing-base-price.dto';
import { addDaysYmd } from './pricing-math.util';
import type { PricingService } from './pricing.service';
import type { PromotionSyncService } from './promotion-sync.service';
import type { PropertyService } from '../property/property.service';
import type { CalendarDatesService } from '../calendar-dates/calendar-dates.service';
import type { PropertyBasePriceEntity } from './entities/property-base-price.entity';
import type { PropertyChannelPricingEntity } from './entities/property-channel-pricing.entity';
import type { PropertyChannelNightPriceEntity } from './entities/property-channel-night-price.entity';
import type { JwtPayload } from '../common/decorators/current-user.decorator';

const OWNER: JwtPayload = { sub: 'u1', email: 'anna@example.com', role: 'OWNER' };
const PROP = 'p1';
const EXT = '11021398';

function setup(
  opts: {
    env?: Record<string, unknown>;
    base?: Array<{ date: string; priceMinor: number }>;
    typed?: Array<{ date: string; priceMinor: number; channel?: string }>;
    rules?: Array<Partial<PropertyChannelPricingEntity>>;
    datesEnabled?: boolean;
    ext?: string | null;
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
      return { id };
    }),
  };
  const dates = {
    enabled: opts.datesEnabled ?? true,
    previewPrices: jest.fn(async (_u: unknown, _p: string, t: Map<string, number>) => ({ action: 'price', targets: [...t] })),
    startPrices: jest.fn(async (_u: unknown, _p: string, t: Map<string, number>) => ({ action: 'price', state: 'running', targets: [...t] })),
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
  };
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
  );
  return { svc, baseRepo, channelRepo, nightPriceRepo, dates, tx, dataSource, sync };
}

const NOV = { from: '2026-11-01', to: '2026-11-04' };

describe('PricingBasePriceService — switches', () => {
  it('answers 503 while the flag is off and never touches the tables or Booking', async () => {
    const s = setup({ env: { ZODOMUS_PROMOTIONS_BASE_PRICE_ENABLED: false } });
    await expect(s.svc.overview(OWNER, PROP, NOV.from, NOV.to)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(s.svc.setRange(OWNER, PROP, { ...NOV, price: 500 })).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(s.svc.setNights(OWNER, PROP, { prices: { '2026-11-01': 500 } })).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(s.svc.saveChannel(OWNER, PROP, 'booking', { markupPct: 10 })).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(s.svc.previewBooking(OWNER, PROP, NOV)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(s.svc.sendBooking(OWNER, PROP, NOV)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(s.baseRepo.find).not.toHaveBeenCalled();
    expect(s.channelRepo.upsert).not.toHaveBeenCalled();
    expect(s.dataSource.transaction).not.toHaveBeenCalled();
    expect(s.dates.previewPrices).not.toHaveBeenCalled();
    expect(s.dates.startPrices).not.toHaveBeenCalled();
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
    await expect(s.svc.sendBooking(OWNER, 'other', NOV)).rejects.toBeInstanceOf(NotFoundException);
    expect(s.baseRepo.find).not.toHaveBeenCalled();
    expect(s.dates.startPrices).not.toHaveBeenCalled();
  });

  it.each([
    ['not a date', '2026-11-01', '1.11.2026'],
    ['from after to', '2026-11-04', '2026-11-01'],
    ['longer than a year', '2026-11-01', addDaysYmd('2026-11-01', BASE_PRICE_MAX_RANGE_DAYS)],
  ])('refuses a bad range: %s', async (_n, from, to) => {
    const s = setup();
    await expect(s.svc.overview(OWNER, PROP, from, to)).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.svc.sendBooking(OWNER, PROP, { from, to })).rejects.toBeInstanceOf(BadRequestException);
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

  it('night by night (from Booking): upsert, other nights untouched', async () => {
    const s = setup();
    const out = await s.svc.setNights(OWNER, PROP, { prices: { '2026-11-02': 290, '2026-11-01': 284.5 } });
    expect(s.baseRepo.upsert).toHaveBeenCalledWith(
      [
        { propertyId: PROP, date: '2026-11-01', priceMinor: 28450 },
        { propertyId: PROP, date: '2026-11-02', priceMinor: 29000 },
      ],
      ['propertyId', 'date'],
    );
    expect(out).toEqual({ '2026-11-01': 284.5, '2026-11-02': 290 });
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

describe('PricingBasePriceService — Booking prices', () => {
  const base = [
    { date: '2026-11-01', priceMinor: 50000 },
    { date: '2026-11-02', priceMinor: 50000 },
    { date: '2026-11-03', priceMinor: 28400 },
  ];

  it('preview: base × Booking markup (whole zł), a typed Booking price wins, Airbnb prices are ignored', async () => {
    const s = setup({
      base,
      rules: [{ propertyId: PROP, channel: 'booking', markupPct: 10 }, { propertyId: PROP, channel: 'airbnb', markupPct: -50 }],
      typed: [
        { date: '2026-11-02', priceMinor: 45000 },
        { date: '2026-11-03', priceMinor: 99900, channel: 'airbnb' },
      ],
    });
    const p = (await s.svc.previewBooking(OWNER, PROP, NOV)) as unknown as { targets: [string, number][] };
    expect(p.targets).toEqual([
      ['2026-11-01', 550],
      ['2026-11-02', 450],
      ['2026-11-03', 312],
    ]);
  });

  it('preview works in test mode and outside the pilot (it only reads)', async () => {
    const s = setup({ base, env: { ZODOMUS_PROMOTIONS_DRY_RUN: true, ZODOMUS_PROMOTIONS_PROPERTY_ALLOWLIST: 'x' } });
    await expect(s.svc.previewBooking(OWNER, PROP, NOV)).resolves.toBeDefined();
  });

  it('no base price and no typed price for the nights → 400, Booking not asked', async () => {
    const s = setup();
    await expect(s.svc.previewBooking(OWNER, PROP, NOV)).rejects.toThrow('нет базовой цены');
    await expect(s.svc.sendBooking(OWNER, PROP, NOV)).rejects.toThrow('нет базовой цены');
    expect(s.dates.previewPrices).not.toHaveBeenCalled();
    expect(s.dates.startPrices).not.toHaveBeenCalled();
  });

  it('send goes through the dates run with the same targets', async () => {
    const s = setup({ base });
    await s.svc.sendBooking(OWNER, PROP, NOV);
    expect(s.dates.startPrices).toHaveBeenCalledTimes(1);
    expect([...(s.dates.startPrices.mock.calls[0]![2] as Map<string, number>)]).toEqual([
      ['2026-11-01', 500],
      ['2026-11-02', 500],
      ['2026-11-03', 284],
    ]);
  });

  it.each([
    ['test mode', { env: { ZODOMUS_PROMOTIONS_DRY_RUN: true } }, 'тестовый режим'],
    ['outside the pilot', { env: { ZODOMUS_PROMOTIONS_PROPERTY_ALLOWLIST: 'x' } }, 'списке пилота'],
    ['not on Booking', { ext: null }, 'не подключён'],
    ['dates tool off', { datesEnabled: false }, 'ZODOMUS_CALENDAR_DATES_ENABLED'],
  ])('send is refused %s — nothing reaches Booking', async (_n, o, msg) => {
    const s = setup({ base, ...(o as object) });
    await expect(s.svc.sendBooking(OWNER, PROP, NOV)).rejects.toThrow(msg);
    expect(s.dates.startPrices).not.toHaveBeenCalled();
  });
});

describe('base price DTOs', () => {
  it('range: dates, from ≤ to, a positive price or null', () => {
    expect(basePriceRangeSchema.safeParse({ from: '2026-11-01', to: '2026-11-01', price: 500 }).success).toBe(true);
    expect(basePriceRangeSchema.safeParse({ from: '2026-11-01', to: '2026-11-01', price: null }).success).toBe(true);
    expect(basePriceRangeSchema.safeParse({ from: '2026-11-02', to: '2026-11-01', price: 500 }).success).toBe(false);
    expect(basePriceRangeSchema.safeParse({ from: '2026-11-01', to: '2026-11-01', price: 0 }).success).toBe(false);
    expect(basePriceRangeSchema.safeParse({ from: '2026-11-01', to: '2026-11-01', price: 500, extra: 1 }).success).toBe(false);
  });

  it('nights: 1–62 real dates with positive prices', () => {
    expect(basePriceNightsSchema.safeParse({ prices: { '2026-11-01': 500 } }).success).toBe(true);
    expect(basePriceNightsSchema.safeParse({ prices: {} }).success).toBe(false);
    expect(basePriceNightsSchema.safeParse({ prices: { 'nope': 500 } }).success).toBe(false);
    expect(basePriceNightsSchema.safeParse({ prices: { '2026-11-01': -1 } }).success).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 63 }, (_, i) => [addDaysYmd('2026-11-01', i), 500]));
    expect(basePriceNightsSchema.safeParse({ prices: many }).success).toBe(false);
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
