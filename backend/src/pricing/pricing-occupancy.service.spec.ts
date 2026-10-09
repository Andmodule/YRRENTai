import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { PricingConfig } from './pricing-config';
import { PricingOccupancyService } from './pricing-occupancy.service';
import { occupancySettingsSchema } from './dto/pricing-occupancy.dto';
import { addDaysYmd, todayInTz } from './pricing-math.util';
import type { PricingService, PropertyPricingRow } from './pricing.service';
import type { BookingEntity } from '../booking/entities/booking.entity';
import type { PricePromotionEntity } from './entities/price-promotion.entity';
import type { PricingOccupancySettingsEntity } from './entities/pricing-occupancy-settings.entity';
import type { JwtPayload } from '../common/decorators/current-user.decorator';

const OWNER: JwtPayload = { sub: 'u1', email: 'anna@example.com', role: 'OWNER' };
const TODAY = todayInTz('UTC');
const day = (n: number) => addDaysYmd(TODAY, n);
/** Bookings are stored as an instant around noon of the day. */
const noon = (ymd: string) => new Date(`${ymd}T12:00:00.000Z`);

function row(over: Partial<PropertyPricingRow> & { id: string }): PropertyPricingRow {
  return {
    name: over.id.toUpperCase(),
    timezone: 'UTC',
    bookingConnected: true,
    externalPropertyId: `ext-${over.id}`,
    minPrice: null,
    geniusPct: null,
    targetingPct: null,
    inPilot: true,
    promotionsAccess: 'ok',
    promotionsAccessCode: null,
    promotionsAccessDetail: null,
    promotionsAccessCheckedAt: null,
    ...over,
  };
}

function booking(propertyId: string, from: number, to: number, status = 'CONFIRMED') {
  return { id: `${propertyId}-${from}`, propertyId, checkIn: noon(day(from)), checkOut: noon(day(to)), status };
}

function promo(over: Omit<Partial<PricePromotionEntity>, 'targets'> & { targets: Array<Record<string, unknown>> }) {
  return {
    id: 'p1',
    name: 'Осень',
    source: 'rentai',
    status: 'active',
    promotionType: 'basic',
    discountPct: 5,
    stayFrom: day(0),
    stayTo: day(10),
    ...over,
  } as unknown as PricePromotionEntity;
}

function setup(
  opts: {
    env?: Record<string, unknown>;
    rows?: PropertyPricingRow[];
    bookings?: unknown[];
    promos?: PricePromotionEntity[];
    saved?: { horizonDays: number; tiers: Array<{ belowPct: number; discountPct: number }> } | null;
  } = {},
) {
  const values: Record<string, unknown> = {
    ZODOMUS_ENABLED: true,
    ZODOMUS_PROMOTIONS_ENABLED: true,
    ZODOMUS_PROMOTIONS_OCCUPANCY_ENABLED: true,
    ...opts.env,
  };
  const cfg = new PricingConfig({ get: (k: string) => values[k] } as unknown as ConfigService);
  let saved = opts.saved ?? null;
  const settingsRepo = {
    findOne: jest.fn(async () => (saved ? { ownerId: 'owner-1', ...saved } : null)),
    upsert: jest.fn(async (r: { horizonDays: number; tiers: Array<{ belowPct: number; discountPct: number }> }) => {
      saved = { horizonDays: r.horizonDays, tiers: r.tiers };
    }),
  };
  const params: Record<string, unknown> = {};
  type Qb = {
    select: jest.Mock;
    where: (sql: string, p: Record<string, unknown>) => Qb;
    andWhere: (sql: string, p: Record<string, unknown>) => Qb;
    getMany: () => Promise<unknown[]>;
  };
  const qb: Qb = {
    select: jest.fn().mockReturnThis(),
    where: (_sql, p) => (Object.assign(params, p), qb),
    andWhere: (_sql, p) => (Object.assign(params, p), qb),
    getMany: async () => {
      // what the SQL filter would do
      const free = params.free as string[];
      const ids = params.ids as string[];
      return ((opts.bookings ?? []) as Array<{ propertyId: string; status: string }>).filter(
        (b) => ids.includes(b.propertyId) && !free.includes(b.status),
      );
    },
  };
  const bookingRepo = { createQueryBuilder: jest.fn(() => qb) };
  const promotionRepo = { find: jest.fn(async () => opts.promos ?? []) };
  const pricing = {
    assertEnabled: jest.fn(() => {
      if (!cfg.flags.enabled) throw new ServiceUnavailableException('off');
    }),
    actor: jest.fn(async () => ({ ownerId: 'owner-1', userId: 'u1', label: 'Анна' })),
    listProperties: jest.fn(async () => opts.rows ?? [row({ id: 'a' })]),
  };
  const svc = new PricingOccupancyService(
    cfg,
    pricing as unknown as PricingService,
    settingsRepo as unknown as Repository<PricingOccupancySettingsEntity>,
    bookingRepo as unknown as Repository<BookingEntity>,
    promotionRepo as unknown as Repository<PricePromotionEntity>,
  );
  return { svc, settingsRepo, bookingRepo, promotionRepo, pricing, params };
}

describe('PricingOccupancyService — switches', () => {
  it('answers 503 while the flag is off and never reads the new table', async () => {
    const { svc, settingsRepo, bookingRepo } = setup({ env: { ZODOMUS_PROMOTIONS_OCCUPANCY_ENABLED: false } });
    await expect(svc.overview(OWNER)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      svc.saveSettings(OWNER, { horizonDays: 30, tiers: [{ belowPct: 10, discountPct: 5 }] }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(settingsRepo.findOne).not.toHaveBeenCalled();
    expect(settingsRepo.upsert).not.toHaveBeenCalled();
    expect(bookingRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('needs promotions to be enabled as well', async () => {
    const { svc } = setup({ env: { ZODOMUS_PROMOTIONS_ENABLED: false } });
    await expect(svc.overview(OWNER)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('the flag is off unless it is set', () => {
    const cfg = new PricingConfig({
      get: (k: string) => (({ ZODOMUS_ENABLED: true, ZODOMUS_PROMOTIONS_ENABLED: true }) as Record<string, unknown>)[k],
    } as unknown as ConfigService);
    expect(cfg.flags.occupancy).toBe(false);
  });
});

describe('PricingOccupancyService — settings', () => {
  it('no saved row → the defaults, marked as such', async () => {
    const { svc } = setup();
    const { settings } = await svc.overview(OWNER);
    expect(settings).toEqual({
      horizonDays: 30,
      isDefault: true,
      tiers: [
        { belowPct: 10, discountPct: 12 },
        { belowPct: 20, discountPct: 8 },
        { belowPct: 30, discountPct: 5 },
      ],
    });
  });

  it('saved settings are used, lowest threshold first', async () => {
    const { svc } = setup({
      saved: { horizonDays: 14, tiers: [{ belowPct: 50, discountPct: 5 }, { belowPct: 20, discountPct: 15 }] },
    });
    const { settings, properties } = await svc.overview(OWNER);
    expect(settings).toMatchObject({ horizonDays: 14, isDefault: false });
    expect(settings.tiers.map((t) => t.belowPct)).toEqual([20, 50]);
    expect(properties[0]).toMatchObject({ totalNights: 14, to: day(13), suggestedPct: 15 });
  });

  it('saving stores the tiers sorted for this tenant and returns the recalculated list', async () => {
    const { svc, settingsRepo } = setup();
    const out = await svc.saveSettings(OWNER, {
      horizonDays: 10,
      tiers: [{ belowPct: 60, discountPct: 4 }, { belowPct: 30, discountPct: 9 }],
    });
    expect(settingsRepo.upsert).toHaveBeenCalledWith(
      { ownerId: 'owner-1', horizonDays: 10, tiers: [{ belowPct: 30, discountPct: 9 }, { belowPct: 60, discountPct: 4 }] },
      ['ownerId'],
    );
    expect(out.settings).toMatchObject({ horizonDays: 10, isDefault: false });
    expect(out.properties[0]).toMatchObject({ totalNights: 10, suggestedPct: 9 });
  });
});

describe('PricingOccupancyService — counting nights', () => {
  it('counts booked nights of the window and suggests by the thresholds', async () => {
    const { svc } = setup({
      rows: [row({ id: 'empty' }), row({ id: 'some' }), row({ id: 'busy' })],
      bookings: [
        booking('some', 2, 6), // 4 nights of 30 = 13% → «below 20%» → −8%
        booking('busy', 0, 12), // 12 nights = 40% → nothing
      ],
    });
    const { properties } = await svc.overview(OWNER);
    expect(properties.map((p) => [p.propertyId, p.bookedNights, p.occupancyPct, p.suggestedPct])).toEqual([
      ['empty', 0, 0, 12],
      ['some', 4, 13, 8],
      ['busy', 12, 40, null],
    ]);
    expect(properties[0]).toMatchObject({ from: TODAY, to: day(29), totalNights: 30 });
  });

  it('cancelled, declined and no-show bookings do not occupy nights', async () => {
    const { svc, params } = setup({
      bookings: [booking('a', 1, 5, 'CANCELLED'), booking('a', 6, 8, 'DECLINED'), booking('a', 9, 11, 'NO_SHOW'), booking('a', 12, 14, 'PENDING')],
    });
    const { properties } = await svc.overview(OWNER);
    expect(params.free).toEqual(['CANCELLED', 'DECLINED', 'NO_SHOW']);
    expect(properties[0]!.bookedNights).toBe(2); // only the pending one
  });

  it('a stay that began before today or ends after the window counts only its nights inside', async () => {
    const { svc } = setup({ bookings: [booking('a', -3, 2), booking('a', 28, 40)] });
    expect((await svc.overview(OWNER)).properties[0]!.bookedNights).toBe(4); // 2 + 2
  });

  it('asks for bookings of the listed properties only, with slack for time zones', async () => {
    const { svc, params } = setup({ rows: [row({ id: 'a' }), row({ id: 'b' })] });
    await svc.overview(OWNER);
    expect(params.ids).toEqual(['a', 'b']);
    expect((params.start as Date).getTime()).toBeLessThan(Date.parse(`${TODAY}T00:00:00.000Z`));
    expect((params.end as Date).getTime()).toBeGreaterThan(Date.parse(`${day(30)}T00:00:00.000Z`));
  });

  it('«today» is the property\'s own day', async () => {
    const { svc } = setup({ rows: [row({ id: 'a', timezone: 'Pacific/Kiritimati' })] }); // UTC+14
    const p = (await svc.overview(OWNER)).properties[0]!;
    expect(p.from).toBe(todayInTz('Pacific/Kiritimati'));
    expect(p.to).toBe(addDaysYmd(p.from, 29));
  });
});

describe('PricingOccupancyService — which properties and what stands in the way', () => {
  it('lists only properties on Booking and counts the rest', async () => {
    const { svc } = setup({
      rows: [row({ id: 'a' }), row({ id: 'airbnb', bookingConnected: false }), row({ id: 'direct', bookingConnected: false })],
    });
    const out = await svc.overview(OWNER);
    expect(out.properties.map((p) => p.propertyId)).toEqual(['a']);
    expect(out.notOnBooking).toBe(2);
  });

  it('nothing on Booking → an empty list and no query at all', async () => {
    const { svc, bookingRepo, promotionRepo } = setup({ rows: [row({ id: 'x', bookingConnected: false })] });
    expect(await svc.overview(OWNER)).toMatchObject({ properties: [], notOnBooking: 1 });
    expect(bookingRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(promotionRepo.find).not.toHaveBeenCalled();
  });

  it('says why a suggestion cannot be applied: pilot list, no access to promotions', async () => {
    const { svc } = setup({
      rows: [row({ id: 'ok' }), row({ id: 'pilot', inPilot: false }), row({ id: 'denied', promotionsAccess: 'denied', inPilot: false })],
    });
    expect((await svc.overview(OWNER)).properties.map((p) => [p.propertyId, p.blocked])).toEqual([
      ['ok', null],
      ['pilot', 'NOT_IN_PILOT'],
      ['denied', 'NO_ACCESS'],
    ]);
  });
});

describe('PricingOccupancyService — the discount that is already there', () => {
  const on = (propertyId: string, state = 'on') => ({ propertyId, desiredState: 'on', state });

  it('shows the largest seasonal discount that is live inside the window', async () => {
    const { svc } = setup({
      promos: [
        promo({ id: 'small', discountPct: 5, targets: [on('a')] }),
        promo({ id: 'big', name: 'Basic Deal', source: 'booking', discountPct: 10, targets: [on('a')] }),
        promo({ id: 'queued', discountPct: 7, targets: [on('a', 'pending')] }),
      ],
    });
    expect((await svc.overview(OWNER)).properties[0]!.current).toEqual({
      promotionId: 'big',
      name: 'Basic Deal',
      discountPct: 10,
      source: 'booking',
    });
  });

  it.each([
    ['a last-minute step', promo({ promotionType: 'last_minute', discountPct: 30, targets: [on('a')] })],
    ['a Mobile rate', promo({ promotionType: 'mobile_rate', source: 'booking', discountPct: 30, targets: [on('a')] })],
    ['one switched off by hand', promo({ discountPct: 30, targets: [{ propertyId: 'a', desiredState: 'off', state: 'off' }] })],
    ['one that was not sent', promo({ discountPct: 30, targets: [on('a', 'skipped')] })],
    ['one only simulated', promo({ discountPct: 30, targets: [on('a', 'dry_run')] })],
    ['one of another property', promo({ discountPct: 30, targets: [on('b')] })],
    ['one after the window', promo({ discountPct: 30, stayFrom: day(40), stayTo: day(50), targets: [on('a')] })],
    ['one without dates', promo({ discountPct: 30, stayFrom: null, stayTo: null, targets: [on('a')] })],
  ])('ignores %s', async (_label, p) => {
    const { svc } = setup({ promos: [p] });
    expect((await svc.overview(OWNER)).properties[0]!.current).toBeNull();
  });

  it('reads only active discounts of this tenant', async () => {
    const { svc, promotionRepo } = setup();
    await svc.overview(OWNER);
    expect(promotionRepo.find).toHaveBeenCalledWith({
      where: { ownerId: 'owner-1', status: 'active' },
      relations: ['targets'],
    });
  });
});

describe('occupancySettingsSchema', () => {
  const ok = { horizonDays: 30, tiers: [{ belowPct: 10, discountPct: 12 }, { belowPct: 30, discountPct: 5 }] };

  it('accepts a normal request and numbers sent as text', () => {
    expect(occupancySettingsSchema.safeParse(ok).success).toBe(true);
    const parsed = occupancySettingsSchema.parse({ horizonDays: '14', tiers: [{ belowPct: '25', discountPct: '7' }] });
    expect(parsed).toEqual({ horizonDays: 14, tiers: [{ belowPct: 25, discountPct: 7 }] });
  });

  it('accepts the edges: 7 and 120 days, 100% threshold, 99% discount', () => {
    for (const horizonDays of [7, 120]) expect(occupancySettingsSchema.safeParse({ ...ok, horizonDays }).success).toBe(true);
    expect(occupancySettingsSchema.safeParse({ horizonDays: 30, tiers: [{ belowPct: 100, discountPct: 99 }] }).success).toBe(true);
  });

  it.each([
    ['6 days', { ...ok, horizonDays: 6 }],
    ['121 days', { ...ok, horizonDays: 121 }],
    ['half a day', { ...ok, horizonDays: 30.5 }],
    ['no tiers', { ...ok, tiers: [] }],
    ['7 tiers', { ...ok, tiers: Array.from({ length: 7 }, (_, i) => ({ belowPct: 10 + i, discountPct: 20 - i })) }],
    ['a 0% threshold', { ...ok, tiers: [{ belowPct: 0, discountPct: 5 }] }],
    ['a 100% discount', { ...ok, tiers: [{ belowPct: 10, discountPct: 100 }] }],
    ['the same threshold twice', { ...ok, tiers: [{ belowPct: 10, discountPct: 12 }, { belowPct: 10, discountPct: 5 }] }],
    ['a fuller property getting more', { ...ok, tiers: [{ belowPct: 10, discountPct: 5 }, { belowPct: 30, discountPct: 12 }] }],
    ['an unknown field', { ...ok, autoApply: true }],
    ['an unknown tier field', { ...ok, tiers: [{ belowPct: 10, discountPct: 5, note: 'x' }] }],
  ])('rejects %s', (_label, body) => {
    expect(occupancySettingsSchema.safeParse(body).success).toBe(false);
  });
});
