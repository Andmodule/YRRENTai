import { BadRequestException, BadGatewayException, ConflictException } from '@nestjs/common';
import { BOOKING_STATUS } from '@rentai/shared';
import { BookingService } from './booking.service';
import { ZODOMUS_BOOKING_FLOW } from '../integrations/zodomus/zodomus-booking-flow.constants';
import type { BookingEntity } from './entities/booking.entity';

describe('BookingService.create → Zodomus availability', () => {
  function buildService(opts: { overlap?: BookingEntity | null; linked?: boolean } = {}) {
    const saved: BookingEntity[] = [];
    const bookingRepository = {
      findOne: jest.fn(),
      create: jest.fn((partial: Partial<BookingEntity>) => ({ ...partial }) as BookingEntity),
      save: jest.fn(async (row: BookingEntity) => {
        if (!row.id) row.id = 'new-direct-id';
        saved.push(row);
        return row;
      }),
      remove: jest.fn(async (row: BookingEntity) => {
        const idx = saved.indexOf(row);
        if (idx >= 0) saved.splice(idx, 1);
        return row;
      }),
      createQueryBuilder: jest.fn(() => {
        const qb = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(opts.overlap ?? null),
        };
        return qb;
      }),
    };
    const propertyService = {
      findOneForUser: jest.fn().mockResolvedValue({
        id: 'p1',
        ownerId: 'owner-1',
        timezone: 'UTC',
        currency: 'EUR',
        channelListings: opts.linked === false ? [] : undefined,
        zodomusPropertyId: opts.linked === false ? null : '10322630',
      }),
    };
    const zodomusAvailabilityPush = {
      scheduleAvailabilityPush: jest.fn(),
      pushAvailabilityNow: jest.fn().mockResolvedValue({
        pushed: true,
        segmentCount: 1,
        segmentsDispatched: 1,
        targetCount: 1,
        nightsEvaluated: 2,
        dispatchMode: 'inline',
      }),
    };
    const zodomusSync = {
      pullLiveOtaBookingsForDirectBooking: jest.fn().mockResolvedValue({
        attempted: false,
        channels: [],
        imported: 0,
        queueProcessed: 0,
        errors: [],
      }),
      assertStayAllowedByOtaInventory: jest.fn().mockResolvedValue({ ok: true, checked: false }),
      isPropertyZodomusLinked: jest.fn().mockReturnValue(opts.linked !== false),
    };
    const calendarGateway = { emitCalendarChanged: jest.fn() };
    const eventEmitter = { emit: jest.fn() };
    const guestService = {
      resolveOrCreate: jest.fn().mockResolvedValue({ id: 'guest-1' }),
    };

    const service = new BookingService(
      bookingRepository as never,
      eventEmitter as never,
      propertyService as never,
      zodomusAvailabilityPush as never,
      zodomusSync as never,
      calendarGateway as never,
      guestService as never,
    );
    return {
      service,
      bookingRepository,
      zodomusAvailabilityPush,
      zodomusSync,
      calendarGateway,
      saved,
    };
  }

  it('creates a direct booking and awaits availability push (CRM → Zodomus inventory)', async () => {
    const { service, zodomusAvailabilityPush, zodomusSync, calendarGateway, saved } = buildService();

    const result = await service.create(
      {
        propertyId: 'p1',
        guestName: 'Direct Guest',
        guestEmail: 'guest@example.com',
        guestPhone: '+48111111111',
        checkIn: '2026-09-10T12:00:00.000Z',
        checkOut: '2026-09-12T12:00:00.000Z',
        totalPriceMinor: 20000,
        currency: 'EUR',
        guestsCount: 2,
      },
      'u1',
      'OWNER',
    );

    expect(result.id).toBe('new-direct-id');
    expect(result.status).toBe('PENDING');
    expect(result.zodomusReservationId).toBeUndefined();
    expect(saved).toHaveLength(1);
    expect(zodomusSync.pullLiveOtaBookingsForDirectBooking).toHaveBeenCalled();
    expect(zodomusSync.assertStayAllowedByOtaInventory).toHaveBeenCalled();
    expect(zodomusAvailabilityPush.pushAvailabilityNow).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        dateFromISO: expect.any(String),
        dateToISO: expect.any(String),
        awaitUpstream: true,
        ignoreAutoPushDisable: true,
      }),
    );
    expect(zodomusAvailabilityPush.scheduleAvailabilityPush).not.toHaveBeenCalled();
    expect(calendarGateway.emitCalendarChanged).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'booking:create' }),
    );
  });

  it('rolls back local booking when availability push fails', async () => {
    const { service, bookingRepository, zodomusAvailabilityPush, saved } = buildService();
    zodomusAvailabilityPush.pushAvailabilityNow.mockRejectedValue(new Error('upstream 400'));

    await expect(
      service.create(
        {
          propertyId: 'p1',
          guestName: 'Direct Guest',
          checkIn: '2026-09-10T12:00:00.000Z',
          checkOut: '2026-09-12T12:00:00.000Z',
          totalPriceMinor: 10000,
          currency: 'EUR',
        },
        'u1',
        'OWNER',
      ),
    ).rejects.toBeInstanceOf(BadGatewayException);

    expect(bookingRepository.remove).toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it('pulls live OTA before conflict check and still rejects overlap', async () => {
    const overlap = {
      id: 'ota-row',
      guestName: 'OTA Guest',
      checkIn: new Date('2026-09-10T12:00:00.000Z'),
      checkOut: new Date('2026-09-12T12:00:00.000Z'),
      status: BOOKING_STATUS.CONFIRMED,
    } as BookingEntity;

    const { service, zodomusAvailabilityPush, zodomusSync } = buildService({ overlap });
    zodomusSync.pullLiveOtaBookingsForDirectBooking.mockResolvedValue({
      attempted: true,
      channels: [1],
      imported: 1,
      queueProcessed: 0,
      errors: [],
    });

    await expect(
      service.create(
        {
          propertyId: 'p1',
          guestName: 'Direct Guest',
          checkIn: '2026-09-10T12:00:00.000Z',
          checkOut: '2026-09-12T12:00:00.000Z',
          totalPriceMinor: 10000,
          currency: 'EUR',
        },
        'u1',
        'OWNER',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(zodomusSync.pullLiveOtaBookingsForDirectBooking).toHaveBeenCalled();
    expect(zodomusAvailabilityPush.pushAvailabilityNow).not.toHaveBeenCalled();
  });

  it('rejects create when OTA inventory/restrictions block the stay', async () => {
    const { service, zodomusAvailabilityPush, zodomusSync } = buildService();
    zodomusSync.assertStayAllowedByOtaInventory.mockResolvedValue({
      ok: false,
      reason: 'OTA_MIN_STAY',
      minStayRequired: 3,
      nights: 1,
      checked: true,
    });

    await expect(
      service.create(
        {
          propertyId: 'p1',
          guestName: 'Direct Guest',
          checkIn: '2026-09-13T12:00:00.000Z',
          checkOut: '2026-09-14T12:00:00.000Z',
          totalPriceMinor: 10000,
          currency: 'EUR',
        },
        'u1',
        'OWNER',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(zodomusAvailabilityPush.pushAvailabilityNow).not.toHaveBeenCalled();
  });
});

describe('BookingService.transition OTA cancel guard (constants)', () => {
  it('rejects OTA cancel with ZODOMUS_BOOKING_FLOW.OTA_CANCEL_VIA_CHANNEL', async () => {
    const booking = {
      id: 'b1',
      propertyId: 'p1',
      status: BOOKING_STATUS.CONFIRMED,
      zodomusReservationId: 'OTA-99',
      checkIn: new Date('2026-09-01T12:00:00.000Z'),
      checkOut: new Date('2026-09-03T12:00:00.000Z'),
      overbookingConflict: false,
      overbookingConflictWithBookingId: null,
      overbookingDetectedAt: null,
    } as BookingEntity;

    const bookingRepository = {
      findOne: jest.fn().mockResolvedValue(booking),
      save: jest.fn(async (b: BookingEntity) => b),
    };
    const propertyService = {
      findOneForUser: jest.fn().mockResolvedValue({ id: booking.propertyId, timezone: 'UTC' }),
    };
    const zodomusAvailabilityPush = {
      scheduleAvailabilityPush: jest.fn(),
      pushAvailabilityNow: jest.fn(),
    };
    const zodomusSync = {
      pullLiveOtaBookingsForDirectBooking: jest.fn(),
      isPropertyZodomusLinked: jest.fn().mockReturnValue(true),
    };
    const calendarGateway = { emitCalendarChanged: jest.fn() };
    const eventEmitter = { emit: jest.fn() };

    const service = new BookingService(
      bookingRepository as never,
      eventEmitter as never,
      propertyService as never,
      zodomusAvailabilityPush as never,
      zodomusSync as never,
      calendarGateway as never,
      {} as never,
    );

    let caught: unknown;
    try {
      await service.transition('b1', BOOKING_STATUS.CANCELLED, 'u1', 'manager', 'OWNER');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).message).toContain(
      ZODOMUS_BOOKING_FLOW.OTA_CANCEL_VIA_CHANNEL,
    );
    expect(zodomusAvailabilityPush.pushAvailabilityNow).not.toHaveBeenCalled();
  });
});
