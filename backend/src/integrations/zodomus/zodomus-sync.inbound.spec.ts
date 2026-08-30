import { BOOKING_STATUS } from '@rentai/shared';
import { ZodomusSyncService } from './zodomus-sync.service';
import type { BookingEntity } from '../../booking/entities/booking.entity';
import type { PropertyEntity } from '../../property/entities/property.entity';

describe('ZodomusSyncService inbound webhook', () => {
  const property = {
    id: 'prop-1',
    ownerId: 'owner-1',
    timezone: 'Europe/Moscow',
    currency: 'EUR',
    channelListings: [],
  } as unknown as PropertyEntity;

  function buildService(opts: {
    existing?: BookingEntity | null;
    overlap?: BookingEntity | null;
    reservation?: Record<string, unknown>;
  }) {
    const saved: BookingEntity[] = [];
    const bookingRepo = {
      findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.zodomusReservationId) return opts.existing ?? null;
        return null;
      }),
      create: jest.fn((partial: Partial<BookingEntity>) => ({ ...partial }) as BookingEntity),
      save: jest.fn(async (row: BookingEntity) => {
        if (!row.id) row.id = 'new-booking-id';
        saved.push({ ...row });
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

    const zodomus = {
      isEnabled: true,
      getReservation: jest.fn().mockResolvedValue({
        reservationId: 'OTA-100',
        guestFirstName: 'Ada',
        guestLastName: 'Lovelace',
        checkIn: '2026-09-10',
        checkOut: '2026-09-12',
        totalPrice: 120,
        currency: 'EUR',
        status: '1',
        ...opts.reservation,
      }),
    };

    const propertyService = {
      findByZodomusPropertyId: jest.fn().mockResolvedValue(property),
    };
    const availabilityPush = { scheduleAvailabilityPush: jest.fn() };
    const calendarGateway = { emitCalendarChanged: jest.fn() };
    const guestService = {
      resolveOrCreate: jest.fn().mockResolvedValue({ id: 'guest-1' }),
    };
    const config = { get: jest.fn() };
    const listingRepo = { update: jest.fn() };

    const service = new ZodomusSyncService(
      zodomus as never,
      propertyService as never,
      config as never,
      availabilityPush as never,
      calendarGateway as never,
      guestService as never,
      bookingRepo as never,
      listingRepo as never,
    );

    return { service, bookingRepo, zodomus, availabilityPush, calendarGateway, saved };
  }

  it('upserts a new reservation and flags overbooking when overlap exists', async () => {
    const overlap = {
      id: 'direct-1',
      guestName: 'Local Guest',
      status: BOOKING_STATUS.CONFIRMED,
    } as BookingEntity;

    const { service, availabilityPush, calendarGateway, saved } = buildService({
      existing: null,
      overlap,
    });

    await service.processWebhookEvent('ext-prop', 1, 'OTA-100', 1);

    expect(saved.length).toBeGreaterThanOrEqual(1);
    const row = saved[saved.length - 1]!;
    expect(row.zodomusReservationId).toBe('OTA-100');
    expect(row.overbookingConflict).toBe(true);
    expect(row.overbookingConflictWithBookingId).toBe('direct-1');
    expect(availabilityPush.scheduleAvailabilityPush).toHaveBeenCalled();
    expect(calendarGateway.emitCalendarChanged).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'webhook:upsert' }),
    );
  });

  it('cancels reservation on status 3 and clears overbooking flag', async () => {
    const existing = {
      id: 'b-ota',
      propertyId: 'prop-1',
      status: BOOKING_STATUS.CONFIRMED,
      zodomusReservationId: 'OTA-100',
      checkIn: new Date('2026-09-10T09:00:00.000Z'),
      checkOut: new Date('2026-09-12T09:00:00.000Z'),
      overbookingConflict: true,
      overbookingConflictWithBookingId: 'direct-1',
      overbookingDetectedAt: new Date(),
    } as BookingEntity;

    const { service, zodomus, availabilityPush, calendarGateway, saved } = buildService({
      existing,
    });

    await service.processWebhookEvent('ext-prop', 1, 'OTA-100', 3);

    expect(zodomus.getReservation).not.toHaveBeenCalled();
    expect(saved[0]?.status).toBe(BOOKING_STATUS.CANCELLED);
    expect(saved[0]?.overbookingConflict).toBe(false);
    expect(saved[0]?.overbookingConflictWithBookingId).toBeNull();
    expect(availabilityPush.scheduleAvailabilityPush).toHaveBeenCalled();
    expect(calendarGateway.emitCalendarChanged).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'webhook:cancel' }),
    );
  });

  it('clears overbooking when inbound dates no longer overlap', async () => {
    const existing = {
      id: 'b-ota',
      propertyId: 'prop-1',
      status: BOOKING_STATUS.CONFIRMED,
      zodomusReservationId: 'OTA-100',
      overbookingConflict: true,
      overbookingConflictWithBookingId: 'direct-1',
      overbookingDetectedAt: new Date(),
    } as BookingEntity;

    const { service, saved } = buildService({
      existing,
      overlap: null,
      reservation: {
        checkIn: '2026-10-01',
        checkOut: '2026-10-03',
        status: '2',
      },
    });

    await service.processWebhookEvent('ext-prop', 1, 'OTA-100', 2);

    const row = saved[saved.length - 1]!;
    expect(row.overbookingConflict).toBe(false);
    expect(row.overbookingConflictWithBookingId).toBeNull();
  });
});
