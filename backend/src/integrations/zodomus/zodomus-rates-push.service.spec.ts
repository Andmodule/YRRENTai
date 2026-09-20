/**
 * Guarantees POST /rates never auto-fills priceSingle from price
 * (Zodomus rejects that on single rooms / Maximum model).
 */

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
  qb.getOne = jest.fn().mockResolvedValue(null);
  return qb;
}

describe('ZodomusRatesPushService priceSingle', () => {
  let setRates: jest.Mock;
  let service: ZodomusRatesPushService;

  beforeEach(() => {
    setRates = jest.fn().mockResolvedValue({ ok: true });
    const zodomus = {
      isEnabled: true,
      setRates,
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
});
