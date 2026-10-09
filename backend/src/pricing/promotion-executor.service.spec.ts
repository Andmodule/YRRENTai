import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PricingConfig } from './pricing-config';
import { PromotionExecutorService, type ExecutorContext } from './promotion-executor.service';
import { addDaysYmd, promotionHash, promotionMarker, todayInTz } from './pricing-math.util';
import type { ZodomusService } from '../integrations/zodomus/zodomus.service';
import type { PropertyService } from '../property/property.service';
import type { PropertyEntity } from '../property/entities/property.entity';
import type { PricePromotionEntity } from './entities/price-promotion.entity';
import type { PricePromotionTargetEntity } from './entities/price-promotion-target.entity';
import type { PropertyPricingSettingsEntity } from './entities/property-pricing-settings.entity';

const PROPERTY_ID = '11111111-2222-3333-4444-555555555555';
const TARGET_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const EXT = '77700001';
const ROOM = '7770000101';
const RATE = '77700001992';

const today = todayInTz('UTC');
const FROM = addDaysYmd(today, 30);
const TO = addDaysYmd(today, 36);

const ROOM_RATES = {
  rooms: [
    {
      id: ROOM,
      name: 'Single room',
      rates: [
        { id: '77700001991', name: 'Non refundable' },
        { id: RATE, name: 'Standard rate' },
      ],
    },
  ],
};

function availability(price: number, from = FROM, nights = 7) {
  const dates = Array.from({ length: nights }, (_, i) => ({
    date: addDaysYmd(from, i),
    availability: '1',
    booked: '0',
    rates: [{ rateId: RATE, price: String(price), closed: '0' }],
  }));
  return { rooms: [{ id: ROOM, dates }] };
}

function makeCfg(over: Record<string, unknown> = {}): PricingConfig {
  const values: Record<string, unknown> = {
    ZODOMUS_ENABLED: true,
    ZODOMUS_PROMOTIONS_ENABLED: true,
    ZODOMUS_PROMOTIONS_DRY_RUN: false,
    ZODOMUS_PROMOTIONS_VERIFY: true,
    ...over,
  };
  return new PricingConfig({ get: (k: string) => values[k] } as unknown as ConfigService);
}

function makeZodomus() {
  return {
    getRoomRatesRaw: jest.fn().mockResolvedValue(ROOM_RATES),
    getAvailability: jest.fn().mockResolvedValue(availability(420)),
    getPromotions: jest.fn().mockResolvedValue({ promotions: [] }),
    createPromotion: jest
      .fn()
      .mockResolvedValue({ status: { returnCode: 200, promotionId: 'VR1' } }),
    activatePromotion: jest.fn().mockResolvedValue({ status: { returnCode: 200 } }),
    deactivatePromotion: jest.fn().mockResolvedValue({ status: { returnCode: 200 } }),
  };
}

const propertyService = {
  getZodomusRoomIdForChannel: jest.fn().mockReturnValue(null),
} as unknown as PropertyService;

function ctx(
  over: {
    target?: Partial<PricePromotionTargetEntity>;
    promotion?: Partial<PricePromotionEntity>;
    settings?: Partial<PropertyPricingSettingsEntity> | null;
    targetingPct?: number | null;
  } = {},
): ExecutorContext {
  const promotion = {
    id: 'promo-1',
    name: 'Осенняя неделя',
    source: 'rentai',
    status: 'active',
    discountPct: 10,
    stayFrom: FROM,
    stayTo: TO,
    activeWeekdays: null,
    protectMinPrice: true,
    ...over.promotion,
  } as PricePromotionEntity;
  const target = {
    id: TARGET_ID,
    promotionId: promotion.id,
    propertyId: PROPERTY_ID,
    channelId: 1,
    externalPropertyId: EXT,
    desiredState: 'on',
    state: 'pending',
    needsPush: true,
    externalPromotionId: null,
    previousExternalIds: [],
    pushedHash: null,
    version: 1,
    attempts: 0,
    ...over.target,
  } as PricePromotionTargetEntity;
  return {
    target,
    promotion,
    property: {
      id: PROPERTY_ID,
      name: 'Мокотув',
      timezone: 'UTC',
      channelListings: [],
    } as unknown as PropertyEntity,
    settings:
      over.settings === undefined ? null : (over.settings as PropertyPricingSettingsEntity | null),
    targetingPct: over.targetingPct,
  };
}

function hashFor(discountPct = 10, from = FROM, to = TO) {
  return promotionHash({
    discountPct,
    stayFrom: from,
    stayTo: to,
    weekdays: null,
    roomIds: [ROOM],
    rateIds: [RATE],
  });
}

describe('PromotionExecutorService', () => {
  it('dry run: reads only, sends nothing to Booking, records the would-be payload', async () => {
    const z = makeZodomus();
    const ex = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg({ ZODOMUS_PROMOTIONS_DRY_RUN: true }),
    );
    const out = await ex.process(ctx());

    expect(z.createPromotion).not.toHaveBeenCalled();
    expect(z.activatePromotion).not.toHaveBeenCalled();
    expect(z.deactivatePromotion).not.toHaveBeenCalled();
    expect(z.getRoomRatesRaw).toHaveBeenCalledWith(1, EXT);
    expect(out.patch).toMatchObject({
      state: 'dry_run',
      needsPush: false,
      roomIds: [ROOM],
      rateIds: [RATE],
    });
    expect(out.events[0]!.action).toBe('dry_run');
    expect((out.events[0]!.details!.payload as { discount: string }).discount).toBe('10');
  });

  it('dry run is the default when the flag is missing', async () => {
    const z = makeZodomus();
    const cfg = new PricingConfig({
      get: (k: string) =>
        (({ ZODOMUS_ENABLED: true, ZODOMUS_PROMOTIONS_ENABLED: true }) as Record<string, unknown>)[
          k
        ],
    } as unknown as ConfigService);
    expect(cfg.flags.dryRun).toBe(true);
    await new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      cfg,
    ).process(ctx());
    expect(z.createPromotion).not.toHaveBeenCalled();
  });

  it('pilot allowlist: other properties are skipped without any upstream call', async () => {
    const z = makeZodomus();
    const ex = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg({ ZODOMUS_PROMOTIONS_PROPERTY_ALLOWLIST: '99999999-0000-0000-0000-000000000000' }),
    );
    const out = await ex.process(ctx());
    expect(out.patch).toMatchObject({ state: 'skipped', lastErrorCode: 'NOT_IN_ALLOWLIST' });
    for (const fn of Object.values(z)) expect(fn).not.toHaveBeenCalled();
  });

  it('pilot allowlist: the Booking hotel id works as well as the RentAI id', async () => {
    const z = makeZodomus();
    const ex = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg({ ZODOMUS_PROMOTIONS_PROPERTY_ALLOWLIST: ` ${EXT} `, ZODOMUS_PROMOTIONS_VERIFY: false }),
    );
    const out = await ex.process(ctx());
    expect(z.createPromotion).toHaveBeenCalledTimes(1);
    expect(out.patch).toMatchObject({ state: 'on', externalPromotionId: 'VR1' });
  });

  it('pilot allowlist: a mixed list of both kinds of ids', () => {
    const cfg = makeCfg({
      ZODOMUS_PROMOTIONS_PROPERTY_ALLOWLIST: `${PROPERTY_ID.toUpperCase()}, 555`,
    });
    expect(cfg.isInAllowlist(PROPERTY_ID)).toBe(true);
    expect(cfg.isInAllowlist('other', '555')).toBe(true);
    expect(cfg.isInAllowlist('other', '556')).toBe(false);
    expect(cfg.isInAllowlist('other', null)).toBe(false);
    expect(cfg.canWrite('other', '555')).toBe(true);
  });

  it('creates the promotion, then verifies rooms/discount on Booking', async () => {
    const z = makeZodomus();
    z.getPromotions
      .mockResolvedValueOnce({ promotions: [] }) // marker search
      .mockResolvedValueOnce({
        promotions: [
          {
            '@attributes': { id: 'VR1', name: 'x' },
            rooms: { room: { '@attributes': { id: ROOM } } },
            discount: { '@attributes': { value: '10' } },
          },
        ],
      }); // verify
    const ex = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg(),
    );
    const out = await ex.process(ctx());

    expect(z.createPromotion).toHaveBeenCalledTimes(1);
    const payload = z.createPromotion.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      propertyId: EXT,
      type: 'basic',
      discount: '10',
      rooms: [{ id: ROOM }],
      parentRates: [{ id: RATE }],
    });
    expect(payload.name).toBe(promotionMarker(TARGET_ID, 1));
    expect(String(payload.name).length).toBeLessThanOrEqual(20);
    expect(out.patch).toMatchObject({
      state: 'on',
      needsPush: false,
      externalPromotionId: 'VR1',
      pushedHash: hashFor(),
      verifyNote: null,
    });
    expect(out.patch.verifiedAt).toBeInstanceOf(Date);
    expect(out.retry).toBeNull();
  });

  it('idempotent retry: adopts a promotion found by its marker instead of creating a duplicate', async () => {
    const z = makeZodomus();
    z.getPromotions.mockResolvedValue({
      promotions: [
        {
          '@attributes': {
            id: 'VR-LOST',
            name: promotionMarker(TARGET_ID, 1),
          },
        },
      ],
    });
    const ex = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg({ ZODOMUS_PROMOTIONS_VERIFY: false }),
    );
    const out = await ex.process(ctx({ target: { attempts: 2 } }));

    expect(z.createPromotion).not.toHaveBeenCalled();
    expect(out.patch).toMatchObject({ state: 'on', externalPromotionId: 'VR-LOST' });
    expect(out.events.map((e) => e.action)).toContain('adopted');
  });

  it('minimum price: skips the property when the Genius price would fall below it', async () => {
    const z = makeZodomus();
    z.getAvailability.mockResolvedValue(availability(290));
    const ex = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg(),
    );
    const out = await ex.process(ctx({ settings: { minPriceMinor: 24000, geniusPct: 10 } }));

    expect(z.createPromotion).not.toHaveBeenCalled();
    expect(out.patch).toMatchObject({ state: 'skipped', lastErrorCode: 'BELOW_MIN_PRICE' });
    expect(out.events[0]!.details).toMatchObject({
      lowestPrice: 290,
      guestPrice: 234.9,
      minPrice: 240,
    });
  });

  it('minimum price: a Mobile rate from the extranet stacks on top and is counted', async () => {
    // 300 · 0.9 (Genius) · 0.9 (our deal) = 243 looks fine for a 230 minimum,
    // but a mobile guest also gets −10%: 218.7.
    const settings = { minPriceMinor: 23000, geniusPct: 10 };
    const z = makeZodomus();
    z.getAvailability.mockResolvedValue(availability(300));
    const ex = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg({ ZODOMUS_PROMOTIONS_VERIFY: false }),
    );

    const blocked = await ex.process(ctx({ settings, targetingPct: 10 }));
    expect(z.createPromotion).not.toHaveBeenCalled();
    expect(blocked.patch).toMatchObject({ state: 'skipped', lastErrorCode: 'BELOW_MIN_PRICE' });
    expect(blocked.patch.lastError).toContain('Mobile/Country rate −10%');
    expect(blocked.events[0]!.details).toMatchObject({ guestPrice: 218.7, targetingPct: 10 });

    const sent = await ex.process(ctx({ settings }));
    expect(z.createPromotion).toHaveBeenCalledTimes(1);
    expect(sent.patch).toMatchObject({ state: 'on' });
  });

  it('minimum price: no Booking price → skip (never send blind)', async () => {
    const z = makeZodomus();
    z.getAvailability.mockResolvedValue({ rooms: [] });
    const ex = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg(),
    );
    const out = await ex.process(ctx({ settings: { minPriceMinor: 24000, geniusPct: 10 } }));
    expect(z.createPromotion).not.toHaveBeenCalled();
    expect(out.patch).toMatchObject({ state: 'skipped', lastErrorCode: 'PRICE_UNKNOWN' });
  });

  it('changed parameters: creates a new promotion first, then stops the old one', async () => {
    const z = makeZodomus();
    z.createPromotion.mockResolvedValue({ status: { promotionId: 'NEW' } });
    const ex = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg({ ZODOMUS_PROMOTIONS_VERIFY: false }),
    );
    const out = await ex.process(
      ctx({
        target: { state: 'on', externalPromotionId: 'OLD', pushedHash: hashFor(15) },
        promotion: { discountPct: 10 },
      }),
    );

    expect(z.createPromotion.mock.invocationCallOrder[0]!).toBeLessThan(
      z.deactivatePromotion.mock.invocationCallOrder[0]!,
    );
    expect(z.deactivatePromotion).toHaveBeenCalledWith(1, EXT, 'OLD');
    expect(String((z.createPromotion.mock.calls[0]![0] as { name: string }).name)).toContain(
      promotionMarker(TARGET_ID, 2),
    );
    expect(out.patch).toMatchObject({
      state: 'on',
      externalPromotionId: 'NEW',
      version: 2,
      previousExternalIds: [{ id: 'OLD', deactivated: true }],
    });
  });

  it('unchanged parameters + was off: reactivates the same Booking promotion', async () => {
    const z = makeZodomus();
    const ex = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg({ ZODOMUS_PROMOTIONS_VERIFY: false }),
    );
    const out = await ex.process(
      ctx({ target: { state: 'off', externalPromotionId: 'VR1', pushedHash: hashFor() } }),
    );

    expect(z.activatePromotion).toHaveBeenCalledWith(1, EXT, 'VR1');
    expect(z.createPromotion).not.toHaveBeenCalled();
    expect(out.patch.state).toBe('on');
    expect(out.patch.externalPromotionId).toBeUndefined();
  });

  it('turn off: deactivates on Booking; an already missing id counts as off', async () => {
    const z = makeZodomus();
    const ex = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg(),
    );
    const out = await ex.process(
      ctx({ target: { desiredState: 'off', state: 'on', externalPromotionId: 'VR1' } }),
    );
    expect(z.deactivatePromotion).toHaveBeenCalledWith(1, EXT, 'VR1');
    expect(out.patch).toMatchObject({ state: 'off', needsPush: false });

    z.deactivatePromotion.mockRejectedValueOnce(
      new HttpException({ message: 'x', detail: 'ID_NOT_FOUND' }, 502),
    );
    const out2 = await ex.process(
      ctx({ target: { desiredState: 'off', state: 'on', externalPromotionId: 'VR2' } }),
    );
    expect(out2.patch).toMatchObject({ state: 'off' });
  });

  it('turn off is allowed outside the pilot allowlist but not in dry run', async () => {
    const z = makeZodomus();
    const pilot = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg({ ZODOMUS_PROMOTIONS_PROPERTY_ALLOWLIST: 'someone-else' }),
    );
    await pilot.process(
      ctx({ target: { desiredState: 'off', state: 'on', externalPromotionId: 'VR1' } }),
    );
    expect(z.deactivatePromotion).toHaveBeenCalledTimes(1);

    const z2 = makeZodomus();
    const dry = new PromotionExecutorService(
      z2 as unknown as ZodomusService,
      propertyService,
      makeCfg({ ZODOMUS_PROMOTIONS_DRY_RUN: true }),
    );
    const out = await dry.process(
      ctx({ target: { desiredState: 'off', state: 'on', externalPromotionId: 'VR1' } }),
    );
    expect(z2.deactivatePromotion).not.toHaveBeenCalled();
    expect(out.patch.state).toBe('dry_run');
  });

  it('a whole campaign switched off turns every target off', async () => {
    const z = makeZodomus();
    const ex = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg(),
    );
    await ex.process(
      ctx({
        promotion: { status: 'off' },
        target: { desiredState: 'on', state: 'on', externalPromotionId: 'VR1' },
      }),
    );
    expect(z.deactivatePromotion).toHaveBeenCalledWith(1, EXT, 'VR1');
    expect(z.createPromotion).not.toHaveBeenCalled();
  });

  it('permanent Booking error → state error, no retry', async () => {
    const z = makeZodomus();
    z.createPromotion.mockRejectedValue(
      new HttpException({ message: 'Zodomus API error', detail: 'HOTEL_INELIGIBLE' }, 502),
    );
    const ex = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg(),
    );
    const out = await ex.process(ctx());
    expect(out.retry).toBeNull();
    expect(out.patch).toMatchObject({
      state: 'error',
      needsPush: false,
      lastErrorCode: 'HOTEL_INELIGIBLE',
    });
  });

  it('temporary failure → retry requested, nothing persisted as final', async () => {
    const z = makeZodomus();
    z.createPromotion.mockRejectedValue(new ServiceUnavailableException('Zodomus API unreachable'));
    const ex = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg(),
    );
    const out = await ex.process(ctx());
    expect(out.retry).toMatchObject({ kind: 'TRANSIENT' });
    expect(out.patch).toEqual({});
  });

  it('past stay dates are never sent; a started window is sent from today', async () => {
    const z = makeZodomus();
    const ex = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg({ ZODOMUS_PROMOTIONS_VERIFY: false }),
    );
    const past = await ex.process(
      ctx({ promotion: { stayFrom: addDaysYmd(today, -10), stayTo: addDaysYmd(today, -1) } }),
    );
    expect(past.patch).toMatchObject({ state: 'skipped', lastErrorCode: 'STAY_DATES_PASSED' });
    expect(z.createPromotion).not.toHaveBeenCalled();

    await ex.process(
      ctx({ promotion: { stayFrom: addDaysYmd(today, -2), stayTo: addDaysYmd(today, 3) } }),
    );
    const payload = z.createPromotion.mock.calls[0]![0] as {
      stayDate: { start: string; end: string };
    };
    expect(payload.stayDate).toMatchObject({ start: today, end: addDaysYmd(today, 3) });
  });

  it('extranet (source=booking) promotions are never written', async () => {
    const z = makeZodomus();
    const ex = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg(),
    );
    const out = await ex.process(
      ctx({
        promotion: { source: 'booking' },
        target: { externalPromotionId: 'EXT1', state: 'on' },
      }),
    );
    for (const fn of Object.values(z)) expect(fn).not.toHaveBeenCalled();
    expect(out.patch).toMatchObject({ needsPush: false });
  });
});
