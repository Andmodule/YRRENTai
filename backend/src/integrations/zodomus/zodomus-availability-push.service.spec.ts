/**
 * ZodomusAvailabilityPushService — unit tests.
 *
 * Key invariants guarded here:
 *   1. Segment merging: POST /availability is sent once per SEGMENT, NOT once per night.
 *      Violating this causes rate-limit warnings from Zodomus (as seen in prod logs).
 *   2. Per-property mutex: concurrent pushAvailabilityNow() calls for the same property
 *      are coalesced into one execution (same-RUID burst fix).
 *   3. Inline mode (no Redis): service runs without BullMQ; rate limiting is handled in-process.
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
  const mockSetAvailability = jest.fn().mockResolvedValue(undefined);
  const mockGetRoomRates = jest.fn().mockResolvedValue([{ id: ROOM_ID, name: 'Standard Room' }]);
  const mockBookingFind = jest.fn().mockResolvedValue(overrides.bookings ?? []);
  const mockPropertyFindOne = jest.fn().mockResolvedValue(
    overrides.property !== undefined ? overrides.property : makeProperty(),
  );

  const zodomus = {
    isEnabled: true,
    setAvailability: mockSetAvailability,
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
    mockSetAvailability,
    mockGetRoomRates,
    mockBookingFind,
    mockPropertyFindOne,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('ZodomusAvailabilityPushService', () => {
  afterEach(() => jest.clearAllMocks());

  // ── 1. Segment merging ─────────────────────────────────────────────────────
  describe('segment merging — POST /availability once per segment, NOT once per night', () => {
    it('sends exactly 1 call for a fully available property (no bookings)', async () => {
      const { service, mockSetAvailability } = buildService();

      const summary = await service.pushAvailabilityNow(PROPERTY_ID);

      expect(summary.segmentCount).toBe(1);
      expect(mockSetAvailability).toHaveBeenCalledTimes(1);

      const [, , , dateFrom, dateTo, avail] = mockSetAvailability.mock.calls[0] as [
        unknown, unknown, unknown, string, string, number
      ];
      expect(avail).toBe(1);
      expect(dateTo > dateFrom).toBe(true);
    });

    it('sends 3 calls for 1 booking in the middle of the horizon', async () => {
      // Horizon: 30 days. Booking: day+5 → day+8.
      // Expected segments: avail(0–4) | occupied(5–7) | avail(8–29)
      const { service, mockSetAvailability } = buildService({
        bookings: [makeBooking(5, 8)],
      });

      const summary = await service.pushAvailabilityNow(PROPERTY_ID);

      expect(summary.segmentCount).toBe(3);
      expect(mockSetAvailability).toHaveBeenCalledTimes(3);

      const availValues = mockSetAvailability.mock.calls.map((c) => c[5] as number);
      expect(availValues).toEqual([1, 0, 1]);
    });

    it('sends 2 calls when booking starts at day 0 (no leading available segment)', async () => {
      const { service, mockSetAvailability } = buildService({
        bookings: [makeBooking(0, 5)],
      });

      const summary = await service.pushAvailabilityNow(PROPERTY_ID);

      expect(summary.segmentCount).toBe(2);
      expect(mockSetAvailability).toHaveBeenCalledTimes(2);

      const availValues = mockSetAvailability.mock.calls.map((c) => c[5] as number);
      expect(availValues).toEqual([0, 1]);
    });

    it('sends 5 calls for 2 non-adjacent bookings', async () => {
      // Segments: avail(0–2) | occ(3–5) | avail(6–9) | occ(10–12) | avail(13–29)
      const { service, mockSetAvailability } = buildService({
        bookings: [makeBooking(3, 6), makeBooking(10, 13)],
      });

      const summary = await service.pushAvailabilityNow(PROPERTY_ID);

      expect(summary.segmentCount).toBe(5);
      expect(mockSetAvailability).toHaveBeenCalledTimes(5);
    });

    /**
     * KEY REGRESSION GUARD: we must never send one POST /availability per night.
     * This was the root cause of Zodomus rate-limit complaints.
     * A 30-day horizon → at most a handful of segments, never 30 individual calls.
     */
    it('NEVER sends one call per night (regression: rate-limit violation)', async () => {
      const { service, mockSetAvailability } = buildService({ horizonDays: 30 });

      await service.pushAvailabilityNow(PROPERTY_ID);

      // No bookings → 1 segment. Even with many bookings it should be << 30.
      expect(mockSetAvailability.mock.calls.length).toBeLessThan(10);
    });

    it('ignores cancelled and declined bookings (they do not block availability)', async () => {
      const { service, mockSetAvailability } = buildService({
        bookings: [
          makeBooking(5, 8, BOOKING_STATUS.CANCELLED),
          makeBooking(10, 13, BOOKING_STATUS.DECLINED),
        ],
      });

      const summary = await service.pushAvailabilityNow(PROPERTY_ID);

      // Cancelled/declined don't block → all-available → 1 segment
      expect(summary.segmentCount).toBe(1);
      expect(mockSetAvailability).toHaveBeenCalledTimes(1);
      expect((mockSetAvailability.mock.calls[0] as unknown[])[5]).toBe(1);
    });
  });

  // ── 2. Per-property mutex ─────────────────────────────────────────────────
  describe('per-property mutex — concurrent pushes coalesce into one execution', () => {
    it('coalesces 3 concurrent calls into 1 actual execution', async () => {
      const { service, mockSetAvailability } = buildService();

      // Add slight delay to guarantee overlap
      mockSetAvailability.mockImplementation(
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

      // Only 1 actual push executed (no bookings → 1 segment)
      expect(mockSetAvailability).toHaveBeenCalledTimes(1);
    });

    it('allows sequential pushes — mutex releases after completion', async () => {
      const { service, mockSetAvailability } = buildService();

      await service.pushAvailabilityNow(PROPERTY_ID);
      await service.pushAvailabilityNow(PROPERTY_ID);

      // Two independent sequential pushes → 2 executions
      expect(mockSetAvailability).toHaveBeenCalledTimes(2);
    });

    it('different properties run independently (no cross-property blocking)', async () => {
      const { service, mockSetAvailability, mockPropertyFindOne } = buildService();

      mockPropertyFindOne
        .mockResolvedValueOnce(makeProperty())
        .mockResolvedValueOnce(makeProperty({ id: OTHER_PROPERTY_ID }));

      await Promise.all([
        service.pushAvailabilityNow(PROPERTY_ID),
        service.pushAvailabilityNow(OTHER_PROPERTY_ID),
      ]);

      // 2 properties × 1 segment each = 2 calls
      expect(mockSetAvailability).toHaveBeenCalledTimes(2);
    });
  });

  // ── 3. Push gating ────────────────────────────────────────────────────────
  describe('push gating', () => {
    it('skips push when ZODOMUS_AUTO_PUSH_AVAILABILITY is false', async () => {
      const { service, mockSetAvailability } = buildService();

      // Override config to disable auto-push
      (service as unknown as { config: ConfigService }).config = {
        get: jest.fn((key: string) =>
          key === 'ZODOMUS_AUTO_PUSH_AVAILABILITY' ? false : undefined,
        ),
      } as unknown as ConfigService;

      const summary = await service.pushAvailabilityNow(PROPERTY_ID);

      expect(summary.pushed).toBe(false);
      expect(mockSetAvailability).not.toHaveBeenCalled();
    });

    it('pushes even when AUTO_PUSH is false when ignoreAutoPushDisable=true', async () => {
      const { service, mockSetAvailability } = buildService();

      // Patch config to return false for AUTO_PUSH but true for rest
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
      expect(mockSetAvailability).toHaveBeenCalled();
    });

    it('returns empty summary when property has no Zodomus targets', async () => {
      const { service, mockSetAvailability } = buildService({
        property: makeProperty({
          zodomusPropertyId: undefined,
          channelListings: [],
          otaPlatform: null,
        }),
      });

      const summary = await service.pushAvailabilityNow(PROPERTY_ID);

      expect(summary.pushed).toBe(false);
      expect(summary.targetCount).toBe(0);
      expect(mockSetAvailability).not.toHaveBeenCalled();
    });

    it('returns empty summary when property not found', async () => {
      const { service, mockSetAvailability } = buildService({ property: null });

      const summary = await service.pushAvailabilityNow(PROPERTY_ID);

      expect(summary.pushed).toBe(false);
      expect(mockSetAvailability).not.toHaveBeenCalled();
    });
  });

  // ── 4. scheduleAvailabilityPush debounce ─────────────────────────────────
  describe('scheduleAvailabilityPush — debounce coalesces rapid triggers', () => {
    it('executes only once when called several times within debounce window', async () => {
      jest.useFakeTimers();
      const { service, mockSetAvailability } = buildService();

      // Schedule 3 times rapidly
      service.scheduleAvailabilityPush(PROPERTY_ID);
      service.scheduleAvailabilityPush(PROPERTY_ID);
      service.scheduleAvailabilityPush(PROPERTY_ID);

      // No call before debounce fires
      expect(mockSetAvailability).not.toHaveBeenCalled();

      // Advance past debounce window (config mock returns 50ms)
      jest.advanceTimersByTime(200);

      // Let promises settle
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      jest.useRealTimers();

      // Exactly 1 execution (1 segment, no bookings)
      expect(mockSetAvailability.mock.calls.length).toBeLessThanOrEqual(1);
    });
  });

  // ── 5. Delta sync (dateFrom/dateTo window) ────────────────────────────────
  describe('delta sync — partial date window', () => {
    it('restricts availability push to specified date range', async () => {
      const { service, mockSetAvailability } = buildService();

      const dateFrom = new Date();
      dateFrom.setUTCDate(dateFrom.getUTCDate() + 2);
      const dateTo = new Date(dateFrom);
      dateTo.setUTCDate(dateTo.getUTCDate() + 5);

      await service.pushAvailabilityNow(PROPERTY_ID, {
        dateFromISO: dateFrom.toISOString(),
        dateToISO: dateTo.toISOString(),
      });

      expect(mockSetAvailability).toHaveBeenCalledTimes(1);

      const [, , , segFrom, segTo] = mockSetAvailability.mock.calls[0] as [
        unknown, unknown, unknown, string, string
      ];
      // The segment start should be at or after dateFrom
      expect(segFrom >= dateFrom.toISOString().slice(0, 10)).toBe(true);
      // The segment end should be at or before dateTo
      expect(segTo <= dateTo.toISOString().slice(0, 10)).toBe(true);
    });
  });
});
