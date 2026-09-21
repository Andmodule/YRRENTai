/**
 * POST /rates: never auto-fill priceSingle; push only free ARI nights
 * as contiguous segments (GET /availability booked==0 && availability!=0).
 */

import { BadRequestException } from '@nestjs/common';
import { ZodomusRatesPushService } from './zodomus-rates-push.service';
import { ZodomusService } from './zodomus.service';
import { Repository } from 'typeorm';
import { PropertyEntity } from '../../property/entities/property.entity';
import { BookingEntity } from '../../booking/entities/booking.entity';

const PROPERTY_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const EXT_PROP = '10322630';
const ROOM_ID = '1032263001';
const RATE_ID = '36621599';
const CHANNEL_ID = 1;

function makeProperty(overrides: Partial<PropertyEntity> = {}): PropertyEntity {
  return {
    id: PROPERTY_ID,
    name: 'Test',
    timezone: 'UTC',
    currency: 'PLN',
    zodomusPropertyId: EXT_PROP,
    zodomusRoomId: ROOM_ID,
    ownerId: 'owner-uuid',
    channelListings: [],
    otaPlatform: { zodomusChannelId: CHANNEL_ID } as PropertyEntity['otaPlatform'],
    ...overrides,
  } as unknown as PropertyEntity;
}

function makeQb() {
  const qb: Record<string, jest.Mock> = {};
  for (const m of ['where', 'andWhere', 'orderBy'] as const) {
    qb[m] = jest.fn().mockReturnValue(qb);
  }
  qb.getMany = jest.fn().mockResolvedValue([]);
  return qb;
}

function availBody(dates: Array<{ date: string; availability?: string; booked?: string }>) {
  return {
    rooms: [
      {
        id: ROOM_ID,
        dates: dates.map((d) => ({
          date: d.date,
          availability: d.availability ?? '1',
          booked: d.booked ?? '0',
          rates: [{ rateId: RATE_ID, price: '100', closed: '0' }],
        })),
      },
    ],
  };
}

describe('ZodomusRatesPushService', () => {
  let setRates: jest.Mock;
  let getAvailability: jest.Mock;
  let service: ZodomusRatesPushService;

  beforeEach(() => {
    setRates = jest.fn().mockResolvedValue({ ok: true });
    getAvailability = jest.fn().mockResolvedValue(
      availBody([
        { date: '2026-10-01' },
        { date: '2026-10-02' },
      ]),
    );
    const zodomus = {
      isEnabled: true,
      setRates,
      getAvailability,
      getRoomRates: jest.fn().mockResolvedValue([{ id: ROOM_ID }]),
      getRoomRatesRaw: jest.fn().mockResolvedValue({
        rooms: [{ id: ROOM_ID, rates: [{ id: RATE_ID, name: 'Standard rate' }] }],
      }),
    } as unknown as ZodomusService;

    const propertyRepo = {
      findOne: jest.fn().mockResolvedValue(makeProperty()),
    } as unknown as Repository<PropertyEntity>;

    const bookingRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(makeQb()),
    } as unknown as Repository<BookingEntity>;

    service = new ZodomusRatesPushService(zodomus, propertyRepo, bookingRepo);
  });

  it('omits priceSingle when UI only sends price', async () => {
    await service.pushRatesForProperty({
      propertyId: PROPERTY_ID,
      dateFrom: '2026-10-01',
      dateToExclusive: '2026-10-03',
      price: 600,
      currencyCode: 'PLN',
    });

    expect(setRates).toHaveBeenCalledTimes(1);
    const arg = setRates.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.price).toBe(600);
    expect(arg.currencyCode).toBe('PLN');
    expect(arg).not.toHaveProperty('priceSingle');
  });

  it('sends priceSingle only when explicitly provided', async () => {
    await service.pushRatesForProperty({
      propertyId: PROPERTY_ID,
      dateFrom: '2026-10-01',
      dateToExclusive: '2026-10-03',
      price: 600,
      priceSingle: 500,
      currencyCode: 'PLN',
    });

    expect(setRates).toHaveBeenCalledTimes(1);
    const arg = setRates.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.priceSingle).toBe(500);
  });

  it('uses property.currency when currencyCode omitted (no EUR hardcode)', async () => {
    await service.pushRatesForProperty({
      propertyId: PROPERTY_ID,
      dateFrom: '2026-10-01',
      dateToExclusive: '2026-10-03',
      price: 600,
    });

    expect(setRates.mock.calls[0][0].currencyCode).toBe('PLN');
  });

  it('falls back to PLN when property currency is not in allowed OTA set', async () => {
    const propertyRepo = {
      findOne: jest.fn().mockResolvedValue(
        makeProperty({ currency: 'GBP' } as Partial<PropertyEntity>),
      ),
    } as unknown as Repository<PropertyEntity>;
    const bookingRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(makeQb()),
    } as unknown as Repository<BookingEntity>;
    const zodomus = {
      isEnabled: true,
      setRates,
      getAvailability,
      getRoomRates: jest.fn().mockResolvedValue([{ id: ROOM_ID }]),
      getRoomRatesRaw: jest.fn().mockResolvedValue({
        rooms: [{ id: ROOM_ID, rates: [{ id: RATE_ID, name: 'Standard rate' }] }],
      }),
    } as unknown as ZodomusService;
    const local = new ZodomusRatesPushService(zodomus, propertyRepo, bookingRepo);

    await local.pushRatesForProperty({
      propertyId: PROPERTY_ID,
      dateFrom: '2026-10-01',
      dateToExclusive: '2026-10-03',
      price: 600,
    });

    expect(setRates.mock.calls[setRates.mock.calls.length - 1][0].currencyCode).toBe('PLN');
  });

  it('splits POST /rates around booked ARI nights', async () => {
    getAvailability.mockResolvedValue(
      availBody([
        { date: '2026-10-01' },
        { date: '2026-10-02', booked: '1' },
        { date: '2026-10-03' },
        { date: '2026-10-04' },
      ]),
    );

    const result = await service.pushRatesForProperty({
      propertyId: PROPERTY_ID,
      dateFrom: '2026-10-01',
      dateToExclusive: '2026-10-05',
      price: 700,
      currencyCode: 'PLN',
    });

    expect(setRates).toHaveBeenCalledTimes(2);
    expect(setRates.mock.calls[0][0]).toMatchObject({
      dateFrom: '2026-10-01',
      dateToExclusive: '2026-10-02',
      price: 700,
      rateId: RATE_ID,
    });
    expect(setRates.mock.calls[1][0]).toMatchObject({
      dateFrom: '2026-10-03',
      dateToExclusive: '2026-10-05',
      price: 700,
    });
    expect(result.targets[0]?.segments).toHaveLength(2);
    expect(result.targets[0]?.ok).toBe(true);
  });

  it('throws BadRequest when no free ARI nights in range', async () => {
    getAvailability.mockResolvedValue(
      availBody([
        { date: '2026-10-01', booked: '1' },
        { date: '2026-10-02', availability: '0' },
      ]),
    );

    await expect(
      service.pushRatesForProperty({
        propertyId: PROPERTY_ID,
        dateFrom: '2026-10-01',
        dateToExclusive: '2026-10-03',
        price: 600,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(setRates).not.toHaveBeenCalled();
  });

  it('uses PLN for Europe/Warsaw when CRM currency is USD default', async () => {
    const propertyRepo = {
      findOne: jest.fn().mockResolvedValue(
        makeProperty({ currency: 'USD', timezone: 'Europe/Warsaw' } as Partial<PropertyEntity>),
      ),
    } as unknown as Repository<PropertyEntity>;
    const bookingRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(makeQb()),
    } as unknown as Repository<BookingEntity>;
    const zodomus = {
      isEnabled: true,
      setRates,
      getAvailability,
      getRoomRates: jest.fn().mockResolvedValue([{ id: ROOM_ID }]),
      getRoomRatesRaw: jest.fn().mockResolvedValue({
        rooms: [{ id: ROOM_ID, rates: [{ id: RATE_ID, name: 'Standard rate' }] }],
      }),
    } as unknown as ZodomusService;
    const local = new ZodomusRatesPushService(zodomus, propertyRepo, bookingRepo);

    await local.pushRatesForProperty({
      propertyId: PROPERTY_ID,
      dateFrom: '2026-10-01',
      dateToExclusive: '2026-10-03',
      price: 600,
      currencyCode: 'USD',
    });

    expect(setRates.mock.calls[setRates.mock.calls.length - 1][0].currencyCode).toBe('PLN');
  });

  it('skips target when rateId is missing from availability', async () => {
    getAvailability.mockResolvedValue({
      rooms: [
        {
          id: ROOM_ID,
          dates: [
            {
              date: '2026-10-01',
              availability: '1',
              booked: '0',
              rates: [{ rateId: 'other-rate', price: '100', closed: '0' }],
            },
          ],
        },
      ],
    });

    await expect(
      service.pushRatesForProperty({
        propertyId: PROPERTY_ID,
        dateFrom: '2026-10-01',
        dateToExclusive: '2026-10-02',
        price: 600,
      }),
    ).rejects.toThrow(/not mapped|not present/i);

    expect(setRates).not.toHaveBeenCalled();
  });
});
