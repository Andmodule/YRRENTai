import type { ConfigService } from '@nestjs/config';
import { PricingConfig } from './pricing-config';
import { PromotionExecutorService, type ExecutorContext } from './promotion-executor.service';
import { addDaysYmd, promotionHash, promotionMarker, todayInTz } from './pricing-math.util';
import type { ZodomusService } from '../integrations/zodomus/zodomus.service';
import type { PropertyService } from '../property/property.service';
import type { PropertyEntity } from '../property/entities/property.entity';
import type { PricePromotionEntity } from './entities/price-promotion.entity';
import type { PricePromotionTargetEntity } from './entities/price-promotion-target.entity';

/** «Автоправила»: a step of the last-minute ladder goes through the same executor as ordinary discounts. */

const PROPERTY_ID = '11111111-2222-3333-4444-555555555555';
const TARGET_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const EXT = '77700001';
const ROOM = '7770000101';
const RATE = '77700001992';

const today = todayInTz('UTC');
const FROM = addDaysYmd(today, 1);
const TO = addDaysYmd(today, 180);

const ROOM_RATES = {
  rooms: [{ id: ROOM, name: 'Single room', rates: [{ id: RATE, name: 'Standard rate' }] }],
};

function availability(price: number) {
  const dates = Array.from({ length: 120 }, (_, i) => ({
    date: addDaysYmd(FROM, i),
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
    ZODOMUS_PROMOTIONS_AUTORULES_ENABLED: true,
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
      .mockResolvedValue({ status: { returnCode: 200, promotionId: 'VR-LM1' } }),
    activatePromotion: jest.fn().mockResolvedValue({ status: { returnCode: 200 } }),
    deactivatePromotion: jest.fn().mockResolvedValue({ status: { returnCode: 200 } }),
  };
}

const propertyService = {
  getZodomusRoomIdForChannel: jest.fn().mockReturnValue(null),
} as unknown as PropertyService;

const STEP_META = {
  rule: { groupId: 'g1', name: 'Горящие', stepIndex: 2, horizonMonths: 6 },
  lastMinute: { unit: 'hour', value: 12 },
  bookTime: { start: 6, end: 12 },
};

function ctx(
  over: {
    target?: Partial<PricePromotionTargetEntity>;
    promotion?: Partial<PricePromotionEntity>;
  } = {},
): ExecutorContext {
  const promotion = {
    id: 'promo-lm',
    name: 'За 12 часов до заезда, бронь 6:00–12:00',
    source: 'rentai',
    promotionType: 'last_minute',
    status: 'active',
    discountPct: 10,
    stayFrom: FROM,
    stayTo: TO,
    activeWeekdays: null,
    protectMinPrice: true,
    externalMeta: STEP_META,
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
    property: { id: PROPERTY_ID, name: 'Мокотув', timezone: 'UTC', channelListings: [] } as unknown as PropertyEntity,
    settings: null,
  };
}

const ruleHash = promotionHash({
  discountPct: 10,
  stayFrom: FROM,
  stayTo: TO,
  weekdays: null,
  roomIds: [ROOM],
  rateIds: [RATE],
  type: 'last_minute',
  lastMinute: { unit: 'hour', value: 12 },
  bookTime: { start: 6, end: 12 },
});

describe('PromotionExecutorService — auto rule steps', () => {
  it('flag off: a step is never sent and no Zodomus call is made', async () => {
    const z = makeZodomus();
    const ex = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg({ ZODOMUS_PROMOTIONS_AUTORULES_ENABLED: false }),
    );
    const out = await ex.process(ctx());

    expect(out.patch).toMatchObject({ state: 'skipped', lastErrorCode: 'AUTORULES_DISABLED' });
    for (const fn of Object.values(z)) expect(fn).not.toHaveBeenCalled();
  });

  it('flag on but the step has no usable «за N» parameters: skipped, nothing sent', async () => {
    const z = makeZodomus();
    const ex = new PromotionExecutorService(z as unknown as ZodomusService, propertyService, makeCfg());
    const out = await ex.process(ctx({ promotion: { externalMeta: { rule: { groupId: 'g1' } } } }));

    expect(out.patch).toMatchObject({ state: 'skipped', lastErrorCode: 'RULE_INVALID' });
    expect(z.createPromotion).not.toHaveBeenCalled();
  });

  it('dry run: records a last_minute payload with book time and sends nothing', async () => {
    const z = makeZodomus();
    const ex = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg({ ZODOMUS_PROMOTIONS_DRY_RUN: true }),
    );
    const out = await ex.process(ctx());

    expect(z.createPromotion).not.toHaveBeenCalled();
    expect(out.patch).toMatchObject({ state: 'dry_run', needsPush: false });
    expect(out.events[0]!.details!.payload).toMatchObject({
      type: 'last_minute',
      lastMinute: { unit: 'hour', value: '12' },
      bookTime: { start: '6', end: '12' },
      discount: '10',
      rooms: [{ id: ROOM }],
      parentRates: [{ id: RATE }],
    });
  });

  it('creates the deal on Booking, stores the rule fingerprint and verifies it', async () => {
    const z = makeZodomus();
    z.getPromotions
      .mockResolvedValueOnce({ promotions: [] }) // marker search
      .mockResolvedValueOnce({
        promotions: [
          {
            '@attributes': { id: 'VR-LM1', name: 'x', type: 'last_minute' },
            rooms: { room: { '@attributes': { id: ROOM } } },
            discount: { '@attributes': { value: '10' } },
            last_minute: { '@attributes': { unit: 'hour', value: '12' } },
            book_time: { '@attributes': { start: '6', end: '12' } },
          },
        ],
      }); // verify
    const ex = new PromotionExecutorService(z as unknown as ZodomusService, propertyService, makeCfg());
    const out = await ex.process(ctx());

    const payload = z.createPromotion.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).toMatchObject({ type: 'last_minute', lastMinute: { unit: 'hour', value: '12' } });
    expect(payload).not.toHaveProperty('bookDate');
    expect(payload.name).toBe(promotionMarker(TARGET_ID, 1));
    expect(out.patch).toMatchObject({
      state: 'on',
      externalPromotionId: 'VR-LM1',
      pushedHash: ruleHash,
      verifyNote: null,
    });
    expect(out.patch.verifiedAt).toBeInstanceOf(Date);
  });

  it('verify flags a mismatch when Booking stored other «за N» or other book hours', async () => {
    const z = makeZodomus();
    z.getPromotions.mockResolvedValueOnce({ promotions: [] }).mockResolvedValueOnce({
      promotions: [
        {
          '@attributes': { id: 'VR-LM1', name: 'x' },
          rooms: { room: { '@attributes': { id: ROOM } } },
          discount: { '@attributes': { value: '10' } },
          last_minute: { '@attributes': { unit: 'day', value: '1' } },
          book_time: { '@attributes': { start: '0', end: '24' } },
        },
      ],
    });
    const ex = new PromotionExecutorService(z as unknown as ZodomusService, propertyService, makeCfg());
    const out = await ex.process(ctx());

    expect(out.patch.verifiedAt).toBeNull();
    expect(out.patch.verifyNote).toMatch(/^MISMATCH:/);
    expect(out.patch.verifyNote).toContain('1 day');
    expect(out.patch.verifyNote).toContain('0–24');
  });

  it('changing the step window recreates the deal and switches the old one off', async () => {
    const z = makeZodomus();
    const ex = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg({ ZODOMUS_PROMOTIONS_VERIFY: false }),
    );
    const out = await ex.process(
      ctx({
        target: {
          state: 'on',
          externalPromotionId: 'VR-OLD',
          pushedHash: promotionHash({
            discountPct: 10,
            stayFrom: FROM,
            stayTo: TO,
            weekdays: null,
            roomIds: [ROOM],
            rateIds: [RATE],
            type: 'last_minute',
            lastMinute: { unit: 'day', value: 1 },
            bookTime: null,
          }),
        },
      }),
    );

    expect(z.createPromotion).toHaveBeenCalledTimes(1);
    expect(z.deactivatePromotion).toHaveBeenCalledWith(1, EXT, 'VR-OLD');
    expect(out.patch).toMatchObject({ externalPromotionId: 'VR-LM1', version: 2, pushedHash: ruleHash });
  });

  it('turning a step off works with the flag off too (emergency stop must never block deactivation)', async () => {
    const z = makeZodomus();
    const ex = new PromotionExecutorService(
      z as unknown as ZodomusService,
      propertyService,
      makeCfg({ ZODOMUS_PROMOTIONS_AUTORULES_ENABLED: false }),
    );
    const out = await ex.process(
      ctx({ promotion: { status: 'off' }, target: { state: 'on', externalPromotionId: 'VR-LM1' } }),
    );

    expect(z.deactivatePromotion).toHaveBeenCalledWith(1, EXT, 'VR-LM1');
    expect(out.patch).toMatchObject({ state: 'off' });
  });
});
