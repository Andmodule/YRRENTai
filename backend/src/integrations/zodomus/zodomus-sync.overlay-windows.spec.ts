import { ZodomusSyncService } from './zodomus-sync.service';
import type { PropertyEntity } from '../../property/entities/property.entity';

const property = {
  id: 'p1',
  ownerId: 'owner-1',
  timezone: 'Europe/Warsaw',
  currency: 'PLN',
  zodomusPropertyId: 'ext-p1',
  channelListings: [{ id: 'l1', externalListingId: 'ext-p1', zodomusRoomId: 'room-1', otaPlatform: { zodomusChannelId: 1 } }],
} as unknown as PropertyEntity;

/** GET /availability answer: one open night per day of [from, toExclusive), price = day of month × 10. */
function availability(from: string, toExclusive: string, closed: string[] = []) {
  const dates = [];
  for (let d = from; d < toExclusive; d = new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
    dates.push({
      date: d,
      availability: '1',
      booked: '0',
      rates: [{ rateId: 'std', closed: closed.includes(d) ? '1' : '0', price: String(Number(d.slice(8)) * 10) }],
    });
  }
  return { rooms: [{ id: 'room-1', dates }] };
}

function buildService(answer: (from: string, to: string) => unknown = availability) {
  const zodomus = {
    isEnabled: true,
    getRoomRatesRaw: jest.fn().mockResolvedValue({}),
    getAvailability: jest.fn((_ch: unknown, _ext: unknown, from: string, to: string) => Promise.resolve(answer(from, to))),
  };
  const propertyService = {
    getExternalListingIdForZodomusChannel: jest.fn().mockReturnValue('ext-p1'),
    getZodomusRoomIdForChannel: jest.fn().mockReturnValue('room-1'),
  };
  const service = new ZodomusSyncService(
    zodomus as never,
    propertyService as never,
    { get: jest.fn().mockReturnValue(0) } as never, // no pacing gap in tests
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, zodomus };
}

describe('ZodomusSyncService calendar overlay — month view', () => {
  it('the 14-day window of the main calendar is still one request', async () => {
    const { service, zodomus } = buildService();
    await service.getInventoryOverlayForProperty(property, '2026-11-01', '2026-11-15');
    expect(zodomus.getAvailability).toHaveBeenCalledTimes(1);
    expect(zodomus.getAvailability).toHaveBeenCalledWith(1, 'ext-p1', '2026-11-01', '2026-11-15');
    expect(zodomus.getRoomRatesRaw).toHaveBeenCalledTimes(1);
  });

  it('a 31-night month is read in two windows (Zodomus refuses more than a month) and merged', async () => {
    const { service, zodomus } = buildService((f, t) => availability(f, t, ['2026-10-30']));
    const o = await service.getInventoryOverlayForProperty(property, '2026-10-01', '2026-11-01');
    expect(zodomus.getAvailability.mock.calls.map((c) => [c[2], c[3]])).toEqual([
      ['2026-10-01', '2026-10-29'],
      ['2026-10-29', '2026-11-01'],
    ]);
    // the room rates are read once per channel, not per window
    expect(zodomus.getRoomRatesRaw).toHaveBeenCalledTimes(1);
    expect(Object.keys(o.nightlyPrices)).toHaveLength(31);
    expect(o.nightlyPrices['2026-10-01']).toBe(10);
    expect(o.nightlyPrices['2026-10-31']).toBe(310);
    expect(o.blockedDays).toEqual(['2026-10-30']);
    expect(o.ariUnavailable).toBe(false);
  });

  it('a failed second window marks the channel failed, like a failed single request', async () => {
    const { service } = buildService((f, t) => {
      if (f === '2026-10-29') throw new Error('Zodomus 500');
      return availability(f, t);
    });
    const o = await service.getInventoryOverlayForProperty(property, '2026-10-01', '2026-11-01');
    expect(o.ariUnavailable).toBe(true);
    expect(o.nightlyPrices).toEqual({});
  });

  it('the month is cached like the short window', async () => {
    const { service, zodomus } = buildService();
    await service.getInventoryOverlayForProperty(property, '2026-10-01', '2026-11-01');
    await service.getInventoryOverlayForProperty(property, '2026-10-01', '2026-11-01');
    expect(zodomus.getAvailability).toHaveBeenCalledTimes(2);
  });
});
