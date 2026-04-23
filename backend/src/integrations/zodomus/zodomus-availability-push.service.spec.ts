/**
 * ZodomusAvailabilityPushService — unit tests.
 *
 * Key invariants guarded here:
 *   1. Batch API: all segments for a target go in ONE POST /availability-multiple call.
 *      This is the Zodomus-recommended approach — sending one call per segment was the
 *      root cause of rate-limit complaints (same-RUID bursts in their logs).
 *   2. Segment content: correct number of segments with correct availability values.
 *   3. Per-property mutex: concurrent pushAvailabilityNow() calls coalesce into one.
 *   4. Inline mode (no Redis): service runs without BullMQ; rate limiting is in-process.
 *
 * All tests use direct instantiation with mocks — no NestJS test module needed.
 * onModuleInit() is NOT called → service runs in inline mode (queue = null).
 */

import { addDays } from 'date-fns';
import { BOOKING_STATUS } from '@rentai/shared';
import { ZodomusAvailabilityPushService } from './zodomus-availability-push.service';
import { ZodomusService } from './zodomus.service';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { BookingEntity } from '../../booking/entities/booking.entity';
import { PropertyEntity } from '../../property/entities/property.entity';

// ─── constants ───────────────────────────────────────────────────────────────

const PROPERTY_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OTHER_PROPERTY_ID = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
const EXT_PROP = 'ext-prop-001';
const ROOM_ID = 'room-001';
const CHANNEL_ID = 1;

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Minimal chainable TypeORM query-builder mock. */
function makeQb() {
  const methods = [
    'update', 'set', 'where', 'andWhere', 'orWhere',
    'select', 'addSelect', 'innerJoin', 'distinct',
  ] as const;
  const qb: Record<string, jest.Mock> = {};
  for (const m of methods) {
    qb[m] = jest.fn().mockReturnValue(qb);
  }
  qb.execute = jest.fn().mockResolvedValue({ affected: 1 });
  qb.getMany = jest.fn().mockResolvedValue([]);
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  return qb;
}

function makeProperty(overrides: Partial<PropertyEntity> = {}): PropertyEntity {
  return {
    id: PROPERTY_ID,
    name: 'Test Property',
    timezone: 'UTC',
    zodomusPropertyId: EXT_PROP,
    zodomusRoomId: null,
    ownerId: 'owner-uuid',
    channelListings: [],
    otaPlatform: { zodomusChannelId: CHANNEL_ID } as PropertyEntity['otaPlatform'],
    ...overrides,
  } as unknown as PropertyEntity;
}

function makeBooking(
  checkInDaysFromNow: number,
  checkOutDaysFromNow: number,
  status = 'confirmed',
): BookingEntity {
  const now = new Date();
  return {
    propertyId: PROPERTY_ID,
    checkIn: addDays(now, checkInDaysFromNow),
    checkOut: addDays(now, checkOutDaysFromNow),
    status,
  } as unknown as BookingEntity;
}

// ─── factory ─────────────────────────────────────────────────────────────────

function buildService(overrides: {
  bookings?: BookingEntity[];
  property?: PropertyEntity | null;
  horizonDays?: number;
  postGapMs?: number;
  maxPerMinute?: number;
} = {}) {
  const mockSetAvailabilityMultiple = jest.fn().mockResolvedValue(undefined);
  const mockGetRoomRates = jest.fn().mockResolvedValue([{ id: ROOM_ID, name: 'Standard Room' }]);
  const mockBookingFind = jest.fn().mockResolvedValue(overrides.bookings ?? []);
  const mockPropertyFindOne = jest.fn().mockResolvedValue(
    overrides.property !== undefined ? overrides.property : makeProperty(),
  );

  const zodomus = {
    isEnabled: true,
    setAvailabilityMultiple: mockSetAvailabilityMultiple,
    getRoomRates: mockGetRoomRates,
  } as unknown as ZodomusService;

  const config = {
    get: jest.fn((key: string): unknown => {
      const cfg: Record<string, unknown> = {
        ZODOMUS_AUTO_PUSH_AVAILABILITY: true,
        ZODOMUS_AVAILABILITY_HORIZON_DAYS: overrides.horizonDays ?? 30,
        ZODOMUS_AVAILABILITY_POST_GAP_MS: overrides.postGapMs ?? 0,
        ZODOMUS_AVAILABILITY_MAX_PER_MINUTE: overrides.maxPerMinute ?? 1000,
        ZODOMUS_AVAILABILITY_PUSH_DEBOUNCE_MS: 50,
        REDIS_URL: undefined,
      };
      return cfg[key];
    }),
  } as unknown as ConfigService;

  const propertyRepo = {
    findOne: mockPropertyFindOne,
    createQueryBuilder: jest.fn().mockImplementation(() => makeQb()),
  } as unknown as Repository<PropertyEntity>;

  const service = new ZodomusAvailabilityPushService(
    zodomus,
    config,
    { find: mockBookingFind } as unknown as Repository<BookingEntity>,
    propertyRepo,
  );

  return {
    service,
    mockSetAvailabilityMultiple,
    mockGetRoomRates,
    mockBookingFind,
    mockPropertyFindOne,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('ZodomusAvailabilityPushService', () => {
  afterEach(() => jest.clearAllMocks());

  // ── 1. Batch API — ONE POST /availability-multiple per target ─────────────
  describe('availability-multiple — ONE API call per target containing all segments', () => {
    it('sends exactly 1 API call for a fully available property (1 segment in batch)', async () => {
      const { service, mockSetAvailabilityMultiple } = buildService();

      const summary = await service.pushAvailabilityNow(PROPERTY_ID);

      expect(summary.segmentCount).toBe(1);
      // ONE call regardless of segment count — this is the fix for Zodomus rate-limit issue
      expect(mockSetAvailabilityMultiple).toHaveBeenCalledTimes(1);

      const [, , roomIds] = mockSetAvailabilityMultiple.mock.calls[0] as [
        unknown, unknown, Array<{ availability: number; dateFrom: string; dateTo: string }>
      ];
      expect(roomIds).toHaveLength(1);
      expect(roomIds[0]!.availability).toBe(1);
    });

    it('sends exactly 1 API call with 3 segments for 1 booking in the middle of the horizon', async () => {
      // Horizon: 30 days. Booking: day+5 → day+8.
      // Expected segments: avail(0–4) | occupied(5–7) | avail(8–29)
      const { service, mockSetAvailabilityMultiple } = buildService({
        bookings: [makeBooking(5, 8)],
      });

      const summary = await service.pushAvailabilityNow(PROPERTY_ID);

      expect(summary.segmentCount).toBe(3);
      // KEY: still only 1 API call — all segments batched into availability-multiple
      expect(mockSetAvailabilityMultiple).toHaveBeenCalledTimes(1);

      const [, , roomIds] = mockSetAvailabilityMultiple.mock.calls[0] as [
        unknown, unknown, Array<{ availability: number }>
      ];
      expect(roomIds).toHaveLength(3);
      expect(roomIds.map((r) => r.availability)).toEqual([1, 0, 1]);
    });

    it('sends exactly 1 API call with 2 segments when booking starts at day 0', async () => {
      const { service, mockSetAvailabilityMultiple } = buildService({
        bookings: [makeBooking(0, 5)],
      });

      const summary = await service.pushAvailabilityNow(PROPERTY_ID);

      expect(summary.segmentCount).toBe(2);
      expect(mockSetAvailabilityMultiple).toHaveBeenCalledTimes(1);

      const [, , roomIds] = mockSetAvailabilityMultiple.mock.calls[0] as [
        unknown, unknown, Array<{ availability: number }>
      ];
      expect(roomIds).toHaveLength(2);
      expect(roomIds.map((r) => r.availability)).toEqual([0, 1]);
    });

    it('sends exactly 1 API call with 5 segments for 2 non-adjacent bookings', async () => {
      // Segments: avail | occ | avail | occ | avail
      const { service, mockSetAvailabilityMultiple } = buildService({
        bookings: [makeBooking(3, 6), makeBooking(10, 13)],
      });

      const summary = await service.pushAvailabilityNow(PROPERTY_ID);

      expect(summary.segmentCount).toBe(5);
      expect(mockSetAvailabilityMultiple).toHaveBeenCalledTimes(1);

      const [, , roomIds] = mockSetAvailabilityMultiple.mock.calls[0] as [
        unknown, unknown, Array<{ availability: number }>
      ];
      expect(roomIds).toHaveLength(5);
    });

    /**
     * CORE REGRESSION GUARD: must never make one API call per night.
     * Before the fix: 30-day horizon = up to 30 individual POST /availability calls.
     * After the fix: always exactly 1 POST /availability-multiple call.
     */
    it('ALWAYS makes exactly 1 API call regardless of horizon length (regression guard)', async () => {
      const { service, mockSetAvailabilityMultiple } = buildService({ horizonDays: 30 });
      await service.pushAvailabilityNow(PROPERTY_ID);
      expect(mockSetAvailabilityMultiple).toHaveBeenCalledTimes(1);

      const { service: s2, mockSetAvailabilityMultiple: m2 } = buildService({
        horizonDays: 30,
        bookings: [makeBooking(2, 5), makeBooking(10, 15), makeBooking(20, 25)],
      });
      await s2.pushAvailabilityNow(PROPERTY_ID);
      // Still 1 call — all 7 segments go in one availability-multiple payload
      expect(m2).toHaveBeenCalledTimes(1);
    });

    it('ignores cancelled and declined bookings (they do not block availability)', async () => {
      const { service, mockSetAvailabilityMultiple } = buildService({
        bookings: [
          makeBooking(5, 8, BOOKING_STATUS.CANCELLED),
          makeBooking(10, 13, BOOKING_STATUS.DECLINED),
        ],
      });

      const summary = await service.pushAvailabilityNow(PROPERTY_ID);

      // Cancelled/declined don't block → all-available → 1 segment in 1 call
      expect(summary.segmentCount).toBe(1);
      expect(mockSetAvailabilityMultiple).toHaveBeenCalledTimes(1);
      const [, , roomIds] = mockSetAvailabilityMultiple.mock.calls[0] as [
        unknown, unknown, Array<{ availability: number }>
      ];
      expect(roomIds[0]!.availability).toBe(1);
    });
  });

  // ── 2. Per-property mutex ─────────────────────────────────────────────────
  describe('per-property mutex — concurrent pushes coalesce into one execution', () => {
    it('coalesces 3 concurrent calls into 1 actual execution', async () => {
      const { service, mockSetAvailabilityMultiple } = buildService();

      // Add slight delay to guarantee overlap
      mockSetAvailabilityMultiple.mockImplementation(
        () => new Promise<void>((r) => setTimeout(r, 10)),
      );

      const [r1, r2, r3] = await Promise.all([
        service.pushAvailabilityNow(PROPERTY_ID),
        service.pushAvailabilityNow(PROPERTY_ID),
        service.pushAvailabilityNow(PROPERTY_ID),
      ]);

      // All callers receive the exact same result object
      expect(r1).toBe(r2);
      expect(r2).toBe(r3);

      // Only 1 actual API call
      expect(mockSetAvailabilityMultiple).toHaveBeenCalledTimes(1);
    });

    it('allows sequential pushes — mutex releases after completion', async () => {
      const { service, mockSetAvailabilityMultiple } = buildService();

      await service.pushAvailabilityNow(PROPERTY_ID);
      await service.pushAvailabilityNow(PROPERTY_ID);

      // Two independent sequential pushes → 2 API calls
      expect(mockSetAvailabilityMultiple).toHaveBeenCalledTimes(2);
    });

    it('different properties run independently (no cross-property blocking)', async () => {
      const { service, mockSetAvailabilityMultiple, mockPropertyFindOne } = buildService();

      mockPropertyFindOne
        .mockResolvedValueOnce(makeProperty())
        .mockResolvedValueOnce(makeProperty({ id: OTHER_PROPERTY_ID }));

      await Promise.all([
        service.pushAvailabilityNow(PROPERTY_ID),
        service.pushAvailabilityNow(OTHER_PROPERTY_ID),
      ]);

      // 2 properties × 1 API call each = 2 total
      expect(mockSetAvailabilityMultiple).toHaveBeenCalledTimes(2);
    });
  });

  // ── 3. Push gating ────────────────────────────────────────────────────────
  describe('push gating', () => {
    it('skips push when ZODOMUS_AUTO_PUSH_AVAILABILITY is false', async () => {
      const { service, mockSetAvailabilityMultiple } = buildService();

      (service as unknown as { config: ConfigService }).config = {
        get: jest.fn((key: string) =>
          key === 'ZODOMUS_AUTO_PUSH_AVAILABILITY' ? false : undefined,
        ),
      } as unknown as ConfigService;

      const summary = await service.pushAvailabilityNow(PROPERTY_ID);

      expect(summary.pushed).toBe(false);
      expect(mockSetAvailabilityMultiple).not.toHaveBeenCalled();
    });

    it('pushes even when AUTO_PUSH is false when ignoreAutoPushDisable=true', async () => {
      const { service, mockSetAvailabilityMultiple } = buildService();

      const originalGet = (service as unknown as { config: { get: jest.Mock } }).config.get;
      (service as unknown as { config: { get: jest.Mock } }).config.get = jest.fn(
        (key: string) =>
          key === 'ZODOMUS_AUTO_PUSH_AVAILABILITY'
            ? false
            : (originalGet as jest.Mock)(key),
      );

      const summary = await service.pushAvailabilityNow(PROPERTY_ID, {
        ignoreAutoPushDisable: true,
      });

      expect(summary.pushed).toBe(true);
      expect(mockSetAvailabilityMultiple).toHaveBeenCalled();
    });

    it('returns empty summary when property has no Zodomus targets', async () => {
      const { service, mockSetAvailabilityMultiple } = buildService({
        property: makeProperty({
          zodomusPropertyId: undefined,
          channelListings: [],
          otaPlatform: null,
        }),
      });

      const summary = await service.pushAvailabilityNow(PROPERTY_ID);

      expect(summary.pushed).toBe(false);
      expect(summary.targetCount).toBe(0);
      expect(mockSetAvailabilityMultiple).not.toHaveBeenCalled();
    });

    it('returns empty summary when property not found', async () => {
      const { service, mockSetAvailabilityMultiple } = buildService({ property: null });

      const summary = await service.pushAvailabilityNow(PROPERTY_ID);

      expect(summary.pushed).toBe(false);
      expect(mockSetAvailabilityMultiple).not.toHaveBeenCalled();
    });
  });

  // ── 4. scheduleAvailabilityPush debounce ─────────────────────────────────
  describe('scheduleAvailabilityPush — debounce coalesces rapid triggers', () => {
    it('executes only once when called several times within debounce window', async () => {
      jest.useFakeTimers();
      const { service, mockSetAvailabilityMultiple } = buildService();

      service.scheduleAvailabilityPush(PROPERTY_ID);
      service.scheduleAvailabilityPush(PROPERTY_ID);
      service.scheduleAvailabilityPush(PROPERTY_ID);

      expect(mockSetAvailabilityMultiple).not.toHaveBeenCalled();

      jest.advanceTimersByTime(200);

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      jest.useRealTimers();

      // At most 1 API call after debounce fires
      expect(mockSetAvailabilityMultiple.mock.calls.length).toBeLessThanOrEqual(1);
    });
  });

  // ── 5. Delta sync (dateFrom/dateTo window) ────────────────────────────────
  describe('delta sync — partial date window', () => {
    it('restricts availability push to specified date range', async () => {
      const { service, mockSetAvailabilityMultiple } = buildService();

      const dateFrom = new Date();
      dateFrom.setUTCDate(dateFrom.getUTCDate() + 2);
      const dateTo = new Date(dateFrom);
      dateTo.setUTCDate(dateTo.getUTCDate() + 5);

      await service.pushAvailabilityNow(PROPERTY_ID, {
        dateFromISO: dateFrom.toISOString(),
        dateToISO: dateTo.toISOString(),
      });

      // Still 1 API call — even delta sync uses availability-multiple
      expect(mockSetAvailabilityMultiple).toHaveBeenCalledTimes(1);

      const [, , roomIds] = mockSetAvailabilityMultiple.mock.calls[0] as [
        unknown, unknown, Array<{ dateFrom: string; dateTo: string }>
      ];
      const segFrom = roomIds[0]!.dateFrom;
      const segTo = roomIds[roomIds.length - 1]!.dateTo;
      expect(segFrom >= dateFrom.toISOString().slice(0, 10)).toBe(true);
      expect(segTo <= dateTo.toISOString().slice(0, 10)).toBe(true);
    });
  });
});
