import { ZodomusSyncService } from './zodomus-sync.service';
import type { PropertyEntity } from '../../property/entities/property.entity';

describe('ZodomusSyncService pullLiveOta (no reservations-summary)', () => {
  const property = {
    id: 'prop-1',
    ownerId: 'owner-1',
    timezone: 'Europe/Warsaw',
    currency: 'USD',
    zodomusPropertyId: '10322630',
    channelListings: [
      {
        id: 'listing-1',
        externalListingId: '10322630',
        zodomusRoomId: '1032263001',
        zodomusSyncFailCount: 0,
        zodomusSyncBlockedUntil: null,
        otaPlatform: { zodomusChannelId: 1 },
      },
    ],
  } as unknown as PropertyEntity;

  function buildService() {
    const bookingRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((partial: unknown) => ({ ...(partial as object) })),
      save: jest.fn(async (row: unknown) => row),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      })),
    };

    const zodomus = {
      isEnabled: true,
      getReservationSummary: jest.fn().mockResolvedValue([]),
      getReservationQueue: jest.fn().mockResolvedValue([]),
      getReservation: jest.fn(),
      checkProperty: jest.fn().mockResolvedValue({ status: { returnCode: 200 } }),
    };

    const propertyService = {
      getExternalListingIdForZodomusChannel: jest.fn().mockReturnValue('10322630'),
      setZodomusStatus: jest.fn().mockResolvedValue(undefined),
      findByIdForAdmin: jest.fn().mockResolvedValue({
        ...property,
        zodomusStatus: 'active',
        zodomusStatusCheckedAt: new Date(),
        zodomusStatusDetail: null,
      }),
      getZodomusRoomIdForChannel: jest.fn().mockReturnValue('1032263001'),
    };

    const availabilityPush = { scheduleAvailabilityPush: jest.fn() };
    const calendarGateway = { emitCalendarChanged: jest.fn() };
    const guestService = { resolveOrCreate: jest.fn() };
    const config = { get: jest.fn().mockReturnValue(0) };
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

    return { service, zodomus, bookingRepo };
  }

  it('pullLiveOtaBookingsForDirectBooking uses queue only — never GET /reservations-summary', async () => {
    const { service, zodomus } = buildService();
    const result = await service.pullLiveOtaBookingsForDirectBooking(property);
    expect(result.attempted).toBe(true);
    expect(zodomus.getReservationSummary).not.toHaveBeenCalled();
    expect(zodomus.getReservationQueue).toHaveBeenCalled();
  });

  it('upserts Warsaw OTA booking without currencyCode as PLN not USD', async () => {
    const { service, zodomus, bookingRepo } = buildService();
    // Shape after ZodomusService.normalizeReservation (rooms totals already resolved).
    zodomus.getReservation.mockResolvedValue({
      reservationId: 'OTA-PLN',
      guestFirstName: 'Jan',
      guestLastName: 'Kowalski',
      checkIn: '2026-10-01',
      checkOut: '2026-10-03',
      totalPrice: 520,
      currency: '',
      currencyCode: '',
      status: '1',
    });
    zodomus.getReservationQueue.mockResolvedValue([{ id: 'OTA-PLN', status: 1 }]);

    await service.pullLiveOtaBookingsForDirectBooking(property);

    expect(zodomus.getReservationSummary).not.toHaveBeenCalled();
    const savedCalls = bookingRepo.save.mock.calls.map(
      (c) => c[0] as { currency?: string; totalPriceMinor?: number },
    );
    const withCurrency = savedCalls.find((r) => r.currency);
    expect(withCurrency?.currency).toBe('PLN');
    expect(withCurrency?.totalPriceMinor).toBe(52000);
  });
});
