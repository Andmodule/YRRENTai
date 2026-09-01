import { BadRequestException, ConflictException } from '@nestjs/common';
import { BOOKING_STATUS } from '@rentai/shared';
import { BookingService } from './booking.service';
import { ZODOMUS_BOOKING_FLOW } from '../integrations/zodomus/zodomus-booking-flow.constants';
import type { BookingEntity } from './entities/booking.entity';

describe('BookingService.create → Zodomus availability', () => {
  function buildService(opts: { overlap?: BookingEntity | null } = {}) {
    const saved: BookingEntity[] = [];
    const bookingRepository = {
      findOne: jest.fn(),
      create: jest.fn((partial: Partial<BookingEntity>) => ({ ...partial }) as BookingEntity),
      save: jest.fn(async (row: BookingEntity) => {
        if (!row.id) row.id = 'new-direct-id';
        saved.push(row);
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
      }),
    };
    const zodomusAvailabilityPush = {
      scheduleAvailabilityPush: jest.fn(),
      pushAvailabilityNow: jest.fn(),
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
      calendarGateway as never,
      guestService as never,
    );
    return { service, bookingRepository, zodomusAvailabilityPush, calendarGateway, saved };
  }

  it('creates a direct booking and schedules availability push (CRM → Zodomus inventory)', async () => {
    const { service, zodomusAvailabilityPush, calendarGateway, saved } = buildService();

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
    expect(zodomusAvailabilityPush.scheduleAvailabilityPush).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        dateFromISO: expect.any(String),
        dateToISO: expect.any(String),
      }),
    );
    expect(calendarGateway.emitCalendarChanged).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'booking:create' }),
    );
  });

  it('rejects overlapping direct create without pushing availability', async () => {
    const overlap = {
      id: 'other',
      guestName: 'Taken',
      checkIn: new Date('2026-09-10T12:00:00.000Z'),
      checkOut: new Date('2026-09-12T12:00:00.000Z'),
      status: BOOKING_STATUS.CONFIRMED,
    } as BookingEntity;

    const { service, zodomusAvailabilityPush } = buildService({ overlap });

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

    expect(zodomusAvailabilityPush.scheduleAvailabilityPush).not.toHaveBeenCalled();
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
    const zodomusAvailabilityPush = { scheduleAvailabilityPush: jest.fn() };
    const calendarGateway = { emitCalendarChanged: jest.fn() };
    const eventEmitter = { emit: jest.fn() };

    const service = new BookingService(
      bookingRepository as never,
      eventEmitter as never,
      propertyService as never,
      zodomusAvailabilityPush as never,
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
    expect(zodomusAvailabilityPush.scheduleAvailabilityPush).not.toHaveBeenCalled();
  });
});
