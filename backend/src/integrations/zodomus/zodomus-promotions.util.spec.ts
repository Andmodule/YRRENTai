import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import {
  buildBasicPromotionPayload,
  buildPromotionName,
  classifyPromotionError,
  extractPromotionId,
  parsePromotionsResponse,
} from './zodomus-promotions.util';

/** Real GET /promotions answer from the Zodomus sandbox (2026-10-04) — Booking XML mirrored to JSON. */
const SANDBOX_LIST = {
  status: { returnCode: 200, returnMessage: 'OK' },
  promotions: [
    {
      '@attributes': {
        id: 'VR12345',
        name: 'Summer Deal',
        type: 'basic',
        target_channel: 'public',
        min_stay_through: '2',
        non_refundable: '-1',
        active: '1',
      },
      last_minute: { '@attributes': { unit: '-1', value: '-1' } },
      early_booker: { '@attributes': { value: '-1' } },
      book_date: { '@attributes': { start: '-1', end: '-1' } },
      stay_date: {
        '@attributes': { start: '2017-08-20', end: '2017-08-30' },
        active_weekdays: { active_weekday: ['Mon', 'Tue', 'wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
        excluded_dates: { excluded_date: '2017-08-22' },
      },
      rooms: { room: [{ '@attributes': { id: '12223' } }, { '@attributes': { id: '12345' } }] },
      parent_rates: { parent_rate: { '@attributes': { id: '435345' } } },
      discount: { '@attributes': { value: '5' } },
    },
    {
      '@attributes': {
        id: 'VR34234',
        name: 'Lastminute hurry',
        type: 'last_minute',
        target_channel: 'public',
        active: '1',
      },
      last_minute: { '@attributes': { unit: 'hour', value: '8' } },
      stay_date: {
        '@attributes': { start: '2016-06-10', end: '2016-06-10' },
        active_weekdays: { active_weekday: 'Fri' },
        excluded_dates: [],
      },
      additional_dates: [],
      rooms: { room: { '@attributes': { id: '1000419' } } },
      parent_rates: {
        parent_rate: [{ '@attributes': { id: '12345' } }, { '@attributes': { id: '47568' } }],
      },
      discount: { '@attributes': { value: '10' } },
      stats: {
        total_revenue: { '@attributes': { value: '418.95', currency: 'EUR' } },
        nr_room_nights: '1',
        nr_bookings: '1',
        nr_cancellations: '0',
      },
    },
  ],
};

describe('parsePromotionsResponse', () => {
  it('parses the sandbox Booking XML shape (object vs array children, "-1" = unset)', () => {
    const [basic, lm] = parsePromotionsResponse(SANDBOX_LIST);

    expect(basic).toMatchObject({
      id: 'VR12345',
      name: 'Summer Deal',
      type: 'basic',
      active: true,
      discountPct: 5,
      targetChannel: 'public',
      stayStart: '2017-08-20',
      stayEnd: '2017-08-30',
      weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      excludedDates: ['2017-08-22'],
      roomIds: ['12223', '12345'],
      rateIds: ['435345'],
      lastMinute: null,
      earlyBookerDays: null,
      stats: null,
    });

    expect(lm).toMatchObject({
      id: 'VR34234',
      type: 'last_minute',
      discountPct: 10,
      weekdays: ['Fri'],
      roomIds: ['1000419'],
      rateIds: ['12345', '47568'],
      lastMinute: { unit: 'hour', value: 8 },
      stats: { revenue: 418.95, currency: 'EUR', nights: 1, bookings: 1, cancellations: 0 },
    });
  });

  it('accepts a plain camelCase JSON shape too', () => {
    const [p] = parsePromotionsResponse({
      promotions: [
        {
          id: 'X1',
          name: 'Plain',
          type: 'basic',
          discount: 15,
          stayDate: { start: '2026-11-02', end: '2026-11-08', activeWeekdays: ['Sat', 'Sun'] },
          rooms: [{ id: 'R1' }],
          parentRates: [{ id: 'RATE1' }],
        },
      ],
    });
    expect(p).toMatchObject({
      id: 'X1',
      discountPct: 15,
      stayStart: '2026-11-02',
      stayEnd: '2026-11-08',
      weekdays: ['Sat', 'Sun'],
      roomIds: ['R1'],
      rateIds: ['RATE1'],
    });
  });

  it('returns [] for unexpected bodies', () => {
    expect(parsePromotionsResponse(null)).toEqual([]);
    expect(parsePromotionsResponse({ status: {} })).toEqual([]);
    expect(parsePromotionsResponse({ promotions: [{ name: 'no id' }] })).toEqual([]);
  });
});

describe('extractPromotionId', () => {
  it('reads status.promotionId (sandbox POST /promotions answer)', () => {
    expect(
      extractPromotionId({
        status: { returnCode: 200, returnMessage: 'OK', promotionId: 'VR210380280' },
      }),
    ).toBe('VR210380280');
  });

  it('falls back to top-level ids and treats empty as missing', () => {
    expect(extractPromotionId({ promotionId: 'A' })).toBe('A');
    expect(extractPromotionId({ id: 'B' })).toBe('B');
    expect(extractPromotionId({ status: { promotionId: '' } })).toBeNull();
    expect(extractPromotionId(undefined)).toBeNull();
  });
});

describe('buildBasicPromotionPayload', () => {
  const base = {
    channelId: 1,
    externalPropertyId: '77700001',
    marker: 'RentAI 1a2b3c4d-1',
    discountPct: 10,
    stayFrom: '2026-11-02',
    stayTo: '2026-11-08',
    roomIds: ['7770000101'],
    rateIds: ['77700001992'],
  };

  it('builds a public Basic deal bookable right away, inheriting min stay', () => {
    expect(buildBasicPromotionPayload({ ...base, weekdays: null })).toEqual({
      channelId: 1,
      propertyId: '77700001',
      name: 'RentAI 1a2b3c4d-1',
      type: 'basic',
      targetChannel: 'public',
      minStayThrough: '0',
      nonRefundable: '0',
      noCcPromotion: '0',
      stayDate: {
        start: '2026-11-02',
        end: '2026-11-08',
        activeWeekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        excludedDates: [],
      },
      rooms: [{ id: '7770000101' }],
      parentRates: [{ id: '77700001992' }],
      discount: '10',
    });
  });

  it('keeps the weekday filter', () => {
    const p = buildBasicPromotionPayload({ ...base, weekdays: ['Sat', 'Sun'] });
    expect((p.stayDate as { activeWeekdays: string[] }).activeWeekdays).toEqual(['Sat', 'Sun']);
  });

  it('name fits the Zodomus 20-char limit and stays ASCII', () => {
    expect(buildPromotionName('RentAI 1a2b3c4d-999')).toBe('RentAI 1a2b3c4d-999');
    expect(buildPromotionName('RentAI 1a2b3c4d-999').length).toBeLessThanOrEqual(20);
    expect(buildPromotionName('Скидка RentAI 1a2b')).toBe(' RentAI 1a2b');
    expect(buildPromotionName('x'.repeat(50))).toHaveLength(20);
  });
});

describe('classifyPromotionError', () => {
  const zodomusError = (detail: string, extra: Record<string, unknown> = {}) =>
    new HttpException(
      {
        message: `Zodomus API error (POST /promotions): returnCode=400 — ${detail}`,
        detail,
        ...extra,
      },
      502,
    );

  it.each([
    ['HOTEL_INELIGIBLE: property cannot use promotions', 'HOTEL_INELIGIBLE', false],
    ['RATES_INVALID', 'RATES_INVALID', false],
    ['ROOMS_INVALID', 'ROOMS_INVALID', false],
    ['DISCOUNT_NOT_IN_RANGE', 'DISCOUNT_NOT_IN_RANGE', false],
    ['STAY_DATE_NOT_IN_FUTURE', 'STAY_DATE_NOT_IN_FUTURE', false],
    ['ID_NOT_FOUND', 'ID_NOT_FOUND', false],
    ['Invalid property id', 'INVALID_PROPERTY', false],
    ['Property status not Active', 'PROPERTY_NOT_ACTIVE', false],
    ['HOTEL_ACCESS_DENIED', 'ACCESS_DENIED', false],
    ['Too many requests', 'RATE_LIMITED', true],
    ['something odd', 'UNKNOWN', true],
  ])('%s → %s', (detail, kind, retryable) => {
    expect(classifyPromotionError(zodomusError(detail))).toMatchObject({ kind, retryable });
  });

  it('HTTP 403 from Booking/Zodomus → ACCESS_DENIED (not retried)', () => {
    const e = new HttpException(
      { message: 'Zodomus upstream error', upstreamStatus: 403, detail: 'Forbidden' },
      502,
    );
    expect(classifyPromotionError(e)).toMatchObject({ kind: 'ACCESS_DENIED', retryable: false });
  });

  it('network / 5xx → TRANSIENT (retried)', () => {
    expect(
      classifyPromotionError(new ServiceUnavailableException('Zodomus API unreachable')),
    ).toMatchObject({
      kind: 'TRANSIENT',
      retryable: true,
    });
    const e = new HttpException(
      { message: 'Zodomus upstream error', upstreamStatus: 503, detail: '' },
      502,
    );
    expect(classifyPromotionError(e).kind).toBe('TRANSIENT');
  });
});
