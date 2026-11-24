import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import type { DataSource, Repository } from 'typeorm';
import { PricingConfig } from './pricing-config';
import { GUEST_PRICE_MAX_RANGE_DAYS, PricingGuestPriceService } from './pricing-guest-price.service';
import { airbnbDealsSchema, channelProfileSchema, nightPricesSchema, observationSchema } from './dto/pricing-guest-price.dto';
import { addDaysYmd } from './pricing-math.util';
import { bookingNightDiscounts, type GuestPriceInput } from './guest-price.util';
import type { PricingService } from './pricing.service';
import type { PropertyService } from '../property/property.service';
import type { PropertyChannelProfileEntity } from './entities/property-channel-profile.entity';
import type { PropertyChannelNightPriceEntity } from './entities/property-channel-night-price.entity';
import type { PriceObservationEntity } from './entities/price-observation.entity';
import type { ObservationDto } from './dto/pricing-guest-price.dto';
import type { JwtPayload } from '../common/decorators/current-user.decorator';

const OWNER: JwtPayload = { sub: '11111111-1111-4111-8111-111111111111', email: 'anna@example.com', role: 'OWNER' };
const PROP = 'p1';

/** K22 Andersa, 25 → 26 Oct 2026, Genius + mobile — the guest saw 217,38 zł on Booking. */
const ANDERSA: GuestPriceInput = {
  nights: [
    {
      date: '2026-10-25',
      rack: 284,
      discounts: bookingNightDiscounts({ ratePlanPct: 15, geniusPct: 19, dealPct: 10, targetingPct: 10 }),
    },
  ],
  fees: [{ kind: 'cleaning', label: 'Уборка', amount: 59 }],
  vatIncludedPct: 8,
};

function missingTable() {
  return new QueryFailedError(
    'SELECT',
    [],
    Object.assign(new Error('relation "property_channel_profiles" does not exist'), { code: '42P01' }),
  );
}

function setup(opts: { env?: Record<string, unknown>; profiles?: Partial<PropertyChannelProfileEntity>[]; deals?: Record<string, unknown> | null } = {}) {
  const values: Record<string, unknown> = {
    ZODOMUS_ENABLED: true,
    ZODOMUS_PROMOTIONS_ENABLED: true,
    ZODOMUS_PROMOTIONS_GUEST_PRICE_ENABLED: true,
    ...opts.env,
  };
  const cfg = new PricingConfig({ get: (k: string) => values[k] } as unknown as ConfigService);
  const pricing = {
    assertEnabled: jest.fn(() => {
      if (!cfg.flags.enabled) throw new ServiceUnavailableException('off');
    }),
  };
  const propertyService = {
    findOneForUser: jest.fn(async (id: string) => {
      if (id !== PROP) throw new NotFoundException('Property not found');
      return { id };
    }),
  };
  let profiles = (opts.profiles ?? []).map((p) => ({ ...p })) as PropertyChannelProfileEntity[];
  const profileRepo = {
    find: jest.fn(async () => profiles),
    findOne: jest.fn(async ({ where }: { where: { channel: string } }) => profiles.find((p) => p.channel === where.channel) ?? null),
    upsert: jest.fn(async (r: PropertyChannelProfileEntity) => {
      const cur = profiles.find((p) => p.channel === r.channel);
      if (cur) Object.assign(cur, r);
      else profiles = [...profiles, { ...r } as PropertyChannelProfileEntity];
    }),
  };
  const nightPriceRepo = { find: jest.fn(async (): Promise<Partial<PropertyChannelNightPriceEntity>[]> => []) };
  const observationRepo = {
    find: jest.fn(async (): Promise<PriceObservationEntity[]> => []),
    create: jest.fn((r: Partial<PriceObservationEntity>) => r),
    save: jest.fn(async (r: Partial<PriceObservationEntity>) => ({ id: 'o1', createdAt: new Date('2026-10-22T15:00:00Z'), ...r })),
  };
  const tx = { delete: jest.fn(async () => undefined), insert: jest.fn(async () => undefined) };
  const dataSource = {
    transaction: jest.fn(async (work: (m: { getRepository: () => typeof tx }) => Promise<void>) =>
      work({ getRepository: () => tx }),
    ),
  };
  const events = { emit: jest.fn() };
  let dealsRow: Record<string, unknown> | null = opts.deals ?? null;
  const dealsRepo = {
    findOne: jest.fn(async () => dealsRow),
    upsert: jest.fn(async (r: Record<string, unknown>) => {
      dealsRow = { ...r };
    }),
  };
  const svc = new PricingGuestPriceService(
    cfg,
    pricing as unknown as PricingService,
    propertyService as unknown as PropertyService,
    dataSource as unknown as DataSource,
    profileRepo as unknown as Repository<PropertyChannelProfileEntity>,
    nightPriceRepo as unknown as Repository<PropertyChannelNightPriceEntity>,
    observationRepo as unknown as Repository<PriceObservationEntity>,
    events as never,
    dealsRepo as never,
  );
  return { svc, dealsRepo, events, profileRepo, nightPriceRepo, observationRepo, tx, dataSource, propertyService, get profiles() { return profiles; } };
}

function observation(over: Partial<Omit<ObservationDto, 'input'>> & { input?: GuestPriceInput } = {}): ObservationDto {
  return {
    channel: 'booking',
    scenario: 'min',
    guests: 2,
    observedTotal: 217.38,
    clientTotal: 217.38,
    input: ANDERSA,
    ...over,
  } as unknown as ObservationDto;
}

describe('PricingGuestPriceService — switches', () => {
  it('answers 503 while the flag is off and never touches the new tables', async () => {
    const s = setup({ env: { ZODOMUS_PROMOTIONS_GUEST_PRICE_ENABLED: false } });
    await expect(s.svc.overview(OWNER, PROP, '2026-10-01', '2026-10-31')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(s.svc.saveProfile(OWNER, PROP, 'booking', { cleaningFee: 59 })).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      s.svc.setNightPrices(OWNER, PROP, { channel: 'airbnb', from: '2026-10-25', to: '2026-10-25', price: 276 }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(s.svc.addObservation(OWNER, PROP, observation())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(s.profileRepo.find).not.toHaveBeenCalled();
    expect(s.profileRepo.upsert).not.toHaveBeenCalled();
    expect(s.dataSource.transaction).not.toHaveBeenCalled();
    expect(s.observationRepo.save).not.toHaveBeenCalled();
  });

  it('needs promotions to be enabled as well', async () => {
    const s = setup({ env: { ZODOMUS_PROMOTIONS_ENABLED: false } });
    await expect(s.svc.overview(OWNER, PROP, '2026-10-01', '2026-10-31')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('flag on before the migration: a clear 503 naming the migration, not a bare 500', async () => {
    const s = setup();
    s.profileRepo.find.mockRejectedValue(missingTable());
    const err = await s.svc.overview(OWNER, PROP, '2026-10-01', '2026-10-31').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as Error).message).toContain('1778600000000-pricing-guest-price');
  });

  it('other database errors are not hidden', async () => {
    const s = setup();
    s.profileRepo.find.mockRejectedValue(new Error('connection reset'));
    await expect(s.svc.overview(OWNER, PROP, '2026-10-01', '2026-10-31')).rejects.toThrow('connection reset');
  });

  it('someone else’s property: 404 and nothing is read or written', async () => {
    const s = setup();
    await expect(s.svc.overview(OWNER, 'other', '2026-10-01', '2026-10-31')).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.svc.saveProfile(OWNER, 'other', 'booking', { cleaningFee: 59 })).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.svc.addObservation(OWNER, 'other', observation())).rejects.toBeInstanceOf(NotFoundException);
    expect(s.profileRepo.find).not.toHaveBeenCalled();
    expect(s.profileRepo.upsert).not.toHaveBeenCalled();
    expect(s.observationRepo.save).not.toHaveBeenCalled();
  });
});

describe('PricingGuestPriceService — overview', () => {
  it.each([
    ['not a date', '2026-10-01', '1.10.2026'],
    ['from after to', '2026-10-31', '2026-10-01'],
    ['too long', '2026-10-01', addDaysYmd('2026-10-01', GUEST_PRICE_MAX_RANGE_DAYS)],
  ])('rejects a bad window: %s', async (_name, from, to) => {
    const s = setup();
    await expect(s.svc.overview(OWNER, PROP, from, to)).rejects.toBeInstanceOf(BadRequestException);
    expect(s.profileRepo.find).not.toHaveBeenCalled();
  });

  it('accepts the longest window', async () => {
    const s = setup();
    await expect(
      s.svc.overview(OWNER, PROP, '2026-10-01', addDaysYmd('2026-10-01', GUEST_PRICE_MAX_RANGE_DAYS - 1)),
    ).resolves.toBeDefined();
  });

  it('nothing saved yet: empty profiles marked as default', async () => {
    const s = setup();
    const o = await s.svc.overview(OWNER, PROP, '2026-10-01', '2026-10-31');
    expect(o.profiles.booking).toMatchObject({ channel: 'booking', cleaningFee: null, extraDiscounts: [], isDefault: true });
    expect(o.profiles.airbnb.isDefault).toBe(true);
    expect(o.nightPrices).toEqual({ booking: {}, airbnb: {} });
    expect(o.observations).toEqual([]);
  });

  it('turns stored minor units back into prices and groups nightly prices by channel', async () => {
    const s = setup({
      profiles: [
        { propertyId: PROP, channel: 'airbnb', cleaningFeeMinor: 5900, nightlyMinor: 29000, weekendNightlyMinor: 35000, weeklyPct: 15, monthlyPct: 20, vatIncludedPct: null, cityTaxPerGuestNightMinor: null, extraDiscounts: null },
      ],
    });
    s.nightPriceRepo.find.mockResolvedValue([
      { propertyId: PROP, channel: 'airbnb', date: '2026-10-25', priceMinor: 27600 },
      { propertyId: PROP, channel: 'airbnb', date: '2026-10-27', priceMinor: 25200 },
    ]);
    s.observationRepo.find.mockResolvedValue([
      {
        id: 'o1', propertyId: PROP, channel: 'booking', scenario: 'min', checkIn: '2026-10-25', nights: 1, guests: 2,
        observedTotalMinor: 21738, calculatedTotalMinor: 26604, input: ANDERSA, createdByUserId: null,
        createdAt: new Date('2026-10-22T14:59:00Z'),
      } as PriceObservationEntity,
    ]);
    const o = await s.svc.overview(OWNER, PROP, '2026-10-01', '2026-10-31');
    expect(o.profiles.airbnb).toMatchObject({ cleaningFee: 59, nightly: 290, weekendNightly: 350, weeklyPct: 15, monthlyPct: 20, isDefault: false });
    expect(o.profiles.booking.isDefault).toBe(true);
    expect(o.nightPrices.airbnb).toEqual({ '2026-10-25': 276, '2026-10-27': 252 });
    expect(o.observations[0]).toMatchObject({ observedTotal: 217.38, calculatedTotal: 266.04, withinTolerance: false });
    expect(o.observations[0]!.deltaPct).toBeCloseTo(22.38, 2);
  });
});

describe('PricingGuestPriceService — profiles', () => {
  it('rejects an unknown channel', async () => {
    const s = setup();
    await expect(s.svc.saveProfile(OWNER, PROP, 'expedia', { cleaningFee: 59 })).rejects.toBeInstanceOf(BadRequestException);
    expect(s.profileRepo.upsert).not.toHaveBeenCalled();
  });

  it('stores money in minor units and writes only the fields that were sent', async () => {
    const s = setup();
    const v = await s.svc.saveProfile(OWNER, PROP, 'booking', {
      cleaningFee: 59,
      vatIncludedPct: 8,
      extraDiscounts: [{ label: 'Вторая скидка в строке Genius', pct: 10 }],
    });
    expect(s.profileRepo.upsert).toHaveBeenCalledWith(
      { propertyId: PROP, channel: 'booking', cleaningFeeMinor: 5900, vatIncludedPct: 8, extraDiscounts: [{ label: 'Вторая скидка в строке Genius', pct: 10 }] },
      ['propertyId', 'channel'],
    );
    expect(v).toMatchObject({ cleaningFee: 59, vatIncludedPct: 8, isDefault: false });
  });

  it('null clears a field; an empty discount list is stored as none', async () => {
    const s = setup({ profiles: [{ propertyId: PROP, channel: 'booking', cleaningFeeMinor: 5900, extraDiscounts: [{ label: 'x', pct: 10 }] }] });
    await s.svc.saveProfile(OWNER, PROP, 'booking', { cleaningFee: null, extraDiscounts: [] });
    expect(s.profileRepo.upsert).toHaveBeenCalledWith(
      { propertyId: PROP, channel: 'booking', cleaningFeeMinor: null, extraDiscounts: null },
      ['propertyId', 'channel'],
    );
  });
});

describe('PricingGuestPriceService — hand-typed nightly prices', () => {
  it('replaces the prices of every night in the range', async () => {
    const s = setup();
    const out = await s.svc.setNightPrices(OWNER, PROP, { channel: 'airbnb', from: '2026-10-25', to: '2026-10-27', price: 276 });
    expect(s.tx.delete).toHaveBeenCalledTimes(1);
    expect(s.tx.insert).toHaveBeenCalledWith([
      { propertyId: PROP, channel: 'airbnb', date: '2026-10-25', priceMinor: 27600 },
      { propertyId: PROP, channel: 'airbnb', date: '2026-10-26', priceMinor: 27600 },
      { propertyId: PROP, channel: 'airbnb', date: '2026-10-27', priceMinor: 27600 },
    ]);
    expect(out).toEqual({ '2026-10-25': 276, '2026-10-26': 276, '2026-10-27': 276 });
  });

  it('price null removes them and inserts nothing', async () => {
    const s = setup();
    const out = await s.svc.setNightPrices(OWNER, PROP, { channel: 'airbnb', from: '2026-10-25', to: '2026-10-27', price: null });
    expect(s.tx.delete).toHaveBeenCalledTimes(1);
    expect(s.tx.insert).not.toHaveBeenCalled();
    expect(out).toEqual({});
  });

  it('a range longer than the limit is refused before any write', async () => {
    const s = setup();
    await expect(
      s.svc.setNightPrices(OWNER, PROP, { channel: 'airbnb', from: '2026-10-01', to: addDaysYmd('2026-10-01', GUEST_PRICE_MAX_RANGE_DAYS), price: 276 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(s.dataSource.transaction).not.toHaveBeenCalled();
  });
});

describe('PricingGuestPriceService — calibration', () => {
  it('recalculates on the server and stores both totals in minor units', async () => {
    const s = setup();
    const v = await s.svc.addObservation(OWNER, PROP, observation());
    expect(s.observationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: PROP,
        channel: 'booking',
        scenario: 'min',
        checkIn: '2026-10-25',
        nights: 1,
        guests: 2,
        observedTotalMinor: 21738,
        calculatedTotalMinor: 21738,
        createdByUserId: OWNER.sub,
      }),
    );
    expect(v).toMatchObject({ deltaPct: 0, withinTolerance: true });
  });

  it('trusts its own calculation, not the panel’s, and logs the drift', async () => {
    const s = setup();
    const warn = jest.spyOn((s.svc as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);
    const v = await s.svc.addObservation(OWNER, PROP, observation({ clientTotal: 200 }));
    expect(v.calculatedTotal).toBe(217.38);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('drift'));
  });

  it('a gap with the channel shows as outside the tolerance', async () => {
    const s = setup();
    const v = await s.svc.addObservation(OWNER, PROP, observation({ observedTotal: 230 }));
    expect(v.withinTolerance).toBe(false);
    expect(v.deltaPct).toBeCloseTo(-5.49, 2);
  });

  it('check-in is the earliest night even when the nights come unsorted', async () => {
    const s = setup();
    const input: GuestPriceInput = {
      nights: [
        { date: '2026-10-26', rack: 290, discounts: [] },
        { date: '2026-10-25', rack: 284, discounts: [] },
      ],
    };
    await s.svc.addObservation(OWNER, PROP, observation({ input, clientTotal: 574, observedTotal: 574 }));
    expect(s.observationRepo.create).toHaveBeenCalledWith(expect.objectContaining({ checkIn: '2026-10-25', nights: 2 }));
  });

  it.each([
    ['a gap between nights', ['2026-10-25', '2026-10-27']],
    ['the same night twice', ['2026-10-25', '2026-10-25']],
  ])('refuses %s', async (_name, dates) => {
    const s = setup();
    const input: GuestPriceInput = { nights: dates.map((date) => ({ date, rack: 100, discounts: [] })) };
    await expect(s.svc.addObservation(OWNER, PROP, observation({ input }))).rejects.toBeInstanceOf(BadRequestException);
    expect(s.observationRepo.save).not.toHaveBeenCalled();
  });
});

describe('guest price DTOs', () => {
  it('profile: unknown fields, a VAT above 50 % and a negative fee are refused; null is fine', () => {
    expect(channelProfileSchema.safeParse({ cleaningFee: 59, foo: 1 }).success).toBe(false);
    expect(channelProfileSchema.safeParse({ vatIncludedPct: 51 }).success).toBe(false);
    expect(channelProfileSchema.safeParse({ cleaningFee: -1 }).success).toBe(false);
    expect(channelProfileSchema.safeParse({ cleaningFee: null, vatIncludedPct: null, extraDiscounts: null }).success).toBe(true);
  });

  it('profile: a hand-typed discount needs a label and 0 < pct < 100; at most five', () => {
    expect(channelProfileSchema.safeParse({ extraDiscounts: [{ label: '', pct: 10 }] }).success).toBe(false);
    expect(channelProfileSchema.safeParse({ extraDiscounts: [{ label: 'x', pct: 0 }] }).success).toBe(false);
    expect(channelProfileSchema.safeParse({ extraDiscounts: [{ label: 'x', pct: 100 }] }).success).toBe(false);
    const six = Array.from({ length: 6 }, (_, i) => ({ label: `x${i}`, pct: 5 }));
    expect(channelProfileSchema.safeParse({ extraDiscounts: six }).success).toBe(false);
  });

  it('nightly prices: Booking or Airbnb, from ≤ to, a positive price or null', () => {
    expect(nightPricesSchema.safeParse({ channel: 'booking', from: '2026-10-25', to: '2026-10-25', price: 1 }).success).toBe(true);
    expect(nightPricesSchema.safeParse({ channel: 'expedia', from: '2026-10-25', to: '2026-10-25', price: 1 }).success).toBe(false);
    expect(nightPricesSchema.safeParse({ channel: 'airbnb', from: '2026-10-26', to: '2026-10-25', price: 1 }).success).toBe(false);
    expect(nightPricesSchema.safeParse({ channel: 'airbnb', from: '2026-10-25', to: '2026-10-25', price: 0 }).success).toBe(false);
    expect(nightPricesSchema.safeParse({ channel: 'airbnb', from: '2026-10-25', to: '2026-10-25', price: null }).success).toBe(true);
  });

  it('observation: 1–60 nights, a positive observed total', () => {
    expect(observationSchema.safeParse(observation()).success).toBe(true);
    expect(observationSchema.safeParse(observation({ input: { nights: [] } })).success).toBe(false);
    const many = Array.from({ length: 61 }, (_, i) => ({ date: addDaysYmd('2026-10-01', i), rack: 100, discounts: [] }));
    expect(observationSchema.safeParse(observation({ input: { nights: many } })).success).toBe(false);
    expect(observationSchema.safeParse(observation({ observedTotal: 0 })).success).toBe(false);
  });
});

describe('guest price — review fixes', () => {
  it('a deal name up to 120 characters (as Booking and RentAI allow) passes; 121 does not', () => {
    const named = (label: string): GuestPriceInput => ({
      nights: [{ date: '2026-10-25', rack: 284, discounts: [{ kind: 'deal', label, pct: 10 }] }],
    });
    expect(observationSchema.safeParse(observation({ input: named('x'.repeat(120)) })).success).toBe(true);
    expect(observationSchema.safeParse(observation({ input: named('x'.repeat(121)) })).success).toBe(false);
  });

  it('a total too big for the integer columns is refused with 400 before saving', async () => {
    const s = setup();
    const many: GuestPriceInput = {
      nights: Array.from({ length: 11 }, (_, i) => ({ date: addDaysYmd('2026-10-01', i), rack: 1_000_000, discounts: [] })),
    };
    await expect(s.svc.addObservation(OWNER, PROP, observation({ input: many, clientTotal: 11_000_000 }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(s.observationRepo.save).not.toHaveBeenCalled();
  });
});

describe('PricingGuestPriceService — «Airbnb — своя цена» tells Airbnb', () => {
  const EVENT = 'pricing.airbnb-own-prices-changed';

  it('an Airbnb price set or cleared → an event for those nights; a Booking price → none', async () => {
    const s = setup();
    await s.svc.setNightPrices(OWNER, PROP, { channel: 'booking', from: '2026-11-06', to: '2026-11-06', price: 385 });
    expect(s.events.emit).not.toHaveBeenCalled();
    await s.svc.setNightPrices(OWNER, PROP, { channel: 'airbnb', from: '2026-11-06', to: '2026-11-07', price: 290 });
    expect(s.events.emit).toHaveBeenLastCalledWith(EVENT, { propertyId: PROP, from: '2026-11-06', to: '2026-11-07' });
    await s.svc.setNightPrices(OWNER, PROP, { channel: 'airbnb', from: '2026-11-06', to: '2026-11-06', price: null });
    expect(s.events.emit).toHaveBeenLastCalledWith(EVENT, { propertyId: PROP, from: '2026-11-06', to: '2026-11-06' });
  });

  it('an event that throws does not fail the save', async () => {
    const s = setup();
    s.events.emit.mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(s.svc.setNightPrices(OWNER, PROP, { channel: 'airbnb', from: '2026-11-06', to: '2026-11-06', price: 290 })).resolves.toEqual({ '2026-11-06': 290 });
  });
});

describe('PricingGuestPriceService — Airbnb own discounts (display only)', () => {
  const ON = { ZODOMUS_PROMOTIONS_AIRBNB_DEALS_ENABLED: true };
  const NOV = ['2026-11-01', '2026-11-04'] as const;
  const PM = { lastMinutePct: 10, lastMinuteDays: 5, earlyBirdPct: 5, earlyBirdMonths: 1 };

  it('switch off (default): not read, overview says off, saving answers 503', async () => {
    const s = setup({ deals: PM });
    const o = await s.svc.overview(OWNER, PROP, ...NOV);
    expect(o).toMatchObject({ airbnbDealsEnabled: false, airbnbDeals: null });
    expect(s.dealsRepo.findOne).not.toHaveBeenCalled();
    await expect(s.svc.saveAirbnbDeals(OWNER, PROP, { ...PM })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('needs «Цена для гостя» on as well', async () => {
    const s = setup({ env: { ...ON, ZODOMUS_PROMOTIONS_GUEST_PRICE_ENABLED: false } });
    await expect(s.svc.saveAirbnbDeals(OWNER, PROP, { ...PM })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('on: overview carries what is saved; nothing saved → null', async () => {
    const s = setup({ env: ON, deals: PM });
    expect((await s.svc.overview(OWNER, PROP, ...NOV)).airbnbDeals).toEqual(PM);
    const e = setup({ env: ON });
    expect((await e.svc.overview(OWNER, PROP, ...NOV))).toMatchObject({ airbnbDealsEnabled: true, airbnbDeals: null });
  });

  it('save: upsert by property; a percent cleared clears its days / months', async () => {
    const s = setup({ env: ON });
    expect(await s.svc.saveAirbnbDeals(OWNER, PROP, { lastMinutePct: 10, lastMinuteDays: 5, earlyBirdPct: null, earlyBirdMonths: 3 })).toEqual({
      lastMinutePct: 10,
      lastMinuteDays: 5,
      earlyBirdPct: null,
      earlyBirdMonths: null,
    });
    expect(s.dealsRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({ propertyId: PROP, earlyBirdMonths: null }), ['propertyId']);
  });

  it('save: someone else’s property → 404, nothing written', async () => {
    const s = setup({ env: ON });
    await expect(s.svc.saveAirbnbDeals(OWNER, 'p2', { ...PM })).rejects.toBeInstanceOf(NotFoundException);
    expect(s.dealsRepo.upsert).not.toHaveBeenCalled();
  });

  it('table missing: overview still works (deals null), saving names the migration', async () => {
    const s = setup({ env: ON });
    s.dealsRepo.findOne.mockRejectedValueOnce(missingTable());
    expect((await s.svc.overview(OWNER, PROP, ...NOV)).airbnbDeals).toBeNull();
    s.dealsRepo.upsert.mockRejectedValueOnce(missingTable());
    await expect(s.svc.saveAirbnbDeals(OWNER, PROP, { ...PM })).rejects.toThrow('1779100000000');
  });

  it('DTO: percents 1–99 whole, days 0–28, months 1–36, a percent needs its days / months, nothing extra', () => {
    expect(airbnbDealsSchema.safeParse(PM).success).toBe(true);
    expect(airbnbDealsSchema.safeParse({ lastMinutePct: null, lastMinuteDays: null, earlyBirdPct: null, earlyBirdMonths: null }).success).toBe(true);
    expect(airbnbDealsSchema.safeParse({ ...PM, lastMinuteDays: 0 }).success).toBe(true);
    for (const bad of [
      { ...PM, lastMinutePct: 0 },
      { ...PM, lastMinutePct: 100 },
      { ...PM, lastMinutePct: 9.5 },
      { ...PM, lastMinuteDays: 29 },
      { ...PM, lastMinuteDays: null },
      { ...PM, earlyBirdMonths: 0 },
      { ...PM, earlyBirdMonths: 37 },
      { ...PM, earlyBirdMonths: null },
      { ...PM, extra: 1 },
      { lastMinutePct: 10, lastMinuteDays: 5 },
      { ...PM, lastMinuteDays: '' },
      { ...PM, lastMinutePct: '10' },
    ]) {
      expect(airbnbDealsSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('observations with Airbnb lead-time discounts', () => {
  it('a calibration whose nights carry «last_minute» / «early_bird» parses and is quoted', async () => {
    const input = {
      nights: [
        { date: '2026-11-25', rack: 300, discounts: [{ kind: 'last_minute', label: 'Последняя минута', pct: 10 }] },
        { date: '2026-11-26', rack: 300, discounts: [{ kind: 'early_bird', label: 'Раннее бронирование', pct: 5 }] },
      ],
      fees: [],
    };
    const dto = { channel: 'airbnb', scenario: 'min', guests: 2, observedTotal: 555, clientTotal: 555, input };
    const parsed = observationSchema.safeParse(dto);
    expect(parsed.success).toBe(true);
    const s = setup();
    const o = await s.svc.addObservation(OWNER, PROP, parsed.success ? (parsed.data as unknown as ObservationDto) : (dto as unknown as ObservationDto));
    // 270 + 285 = 555
    expect(o.calculatedTotal).toBe(555);
    expect(o.withinTolerance).toBe(true);
  });
});

