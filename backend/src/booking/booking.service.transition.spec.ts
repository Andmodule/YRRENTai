import { BadRequestException } from '@nestjs/common';
import { BOOKING_STATUS } from '@rentai/shared';
import { BookingService } from './booking.service';
import type { BookingEntity } from './entities/booking.entity';

describe('BookingService.transition OTA cancel guard', () => {
  function buildService(booking: BookingEntity, linked = true) {
    const bookingRepository = {
      findOne: jest.fn().mockResolvedValue(booking),
      save: jest.fn(async (b: BookingEntity) => b),
    };
    const propertyService = {
      findOneForUser: jest.fn().mockResolvedValue({
        id: booking.propertyId,
        timezone: 'UTC',
        zodomusPropertyId: linked ? '10322630' : null,
        channelListings: [],
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
      pullLiveOtaBookingsForDirectBooking: jest.fn(),
      isPropertyZodomusLinked: jest.fn().mockReturnValue(linked),
    };
    const calendarGateway = {
      emitCalendarChanged: jest.fn(),
    };
    const eventEmitter = { emit: jest.fn() };
    const guestService = {};

    const service = new BookingService(
      bookingRepository as never,
      eventEmitter as never,
      propertyService as never,
      zodomusAvailabilityPush as never,
      zodomusSync as never,
      calendarGateway as never,
      guestService as never,
    );
    return { service, bookingRepository, zodomusAvailabilityPush, calendarGateway };
  }

  it('rejects cancelling an OTA booking from CRM', async () => {
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

    const { service, zodomusAvailabilityPush } = buildService(booking);

    await expect(
      service.transition('b1', BOOKING_STATUS.CANCELLED, 'u1', 'manager', 'OWNER'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(zodomusAvailabilityPush.pushAvailabilityNow).not.toHaveBeenCalled();
    expect(zodomusAvailabilityPush.scheduleAvailabilityPush).not.toHaveBeenCalled();
  });

  it('cancels direct booking and awaits availability push to reopen nights', async () => {
    const booking = {
      id: 'b2',
      propertyId: 'p1',
      status: BOOKING_STATUS.CONFIRMED,
      zodomusReservationId: null,
      checkIn: new Date('2026-09-01T12:00:00.000Z'),
      checkOut: new Date('2026-09-03T12:00:00.000Z'),
      overbookingConflict: true,
      overbookingConflictWithBookingId: 'other',
      overbookingDetectedAt: new Date(),
    } as BookingEntity;

    const { service, bookingRepository, zodomusAvailabilityPush, calendarGateway } =
      buildService(booking);

    const saved = await service.transition(
      'b2',
      BOOKING_STATUS.CANCELLED,
      'u1',
      'manager',
      'OWNER',
    );

    expect(saved.status).toBe(BOOKING_STATUS.CANCELLED);
    expect(saved.overbookingConflict).toBe(false);
    expect(saved.overbookingConflictWithBookingId).toBeNull();
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
    expect(calendarGateway.emitCalendarChanged).toHaveBeenCalled();
    expect(bookingRepository.save).toHaveBeenCalled();
  });
});
