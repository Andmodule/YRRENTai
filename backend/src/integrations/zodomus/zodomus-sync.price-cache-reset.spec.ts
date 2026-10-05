// RENTAI-PRICE-CACHE-RESET (2026-10-05): tests for ZodomusSyncService.invalidateCalendarOverlay.
// Delete this file together with the method when reverting.
import { ZodomusSyncService } from './zodomus-sync.service';
import type { PropertyEntity } from '../../property/entities/property.entity';

function property(id: string): PropertyEntity {
  return {
    id,
    ownerId: 'owner-1',
    timezone: 'Europe/Warsaw',
    currency: 'PLN',
    zodomusPropertyId: `ext-${id}`,
    channelListings: [
      {
        id: `listing-${id}`,
        externalListingId: `ext-${id}`,
        zodomusRoomId: 'room-1',
        otaPlatform: { zodomusChannelId: 1 },
      },
    ],
  } as unknown as PropertyEntity;
}

function buildService() {
  const zodomus = {
    isEnabled: true,
    getRoomRatesRaw: jest.fn().mockResolvedValue({}),
    getAvailability: jest.fn().mockResolvedValue({}),
  };
  const propertyService = {
    getExternalListingIdForZodomusChannel: jest.fn((p: PropertyEntity) => `ext-${p.id}`),
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

describe('ZodomusSyncService.invalidateCalendarOverlay', () => {
  it('without a reset the calendar keeps the cached overlay (no new Zodomus call)', async () => {
    const { service, zodomus } = buildService();
    const p = property('p1');
    await service.getInventoryOverlayForProperty(p, '2026-10-04', '2026-10-18');
    await service.getInventoryOverlayForProperty(p, '2026-10-04', '2026-10-18');
    expect(zodomus.getAvailability).toHaveBeenCalledTimes(1);
  });

  it('after a reset the next calendar load reads Zodomus once; the reset itself calls nothing', async () => {
    const { service, zodomus } = buildService();
    const p = property('p1');
    await service.getInventoryOverlayForProperty(p, '2026-10-04', '2026-10-18');
    await service.getInventoryOverlayForProperty(p, '2026-10-18', '2026-11-01');

    expect(service.invalidateCalendarOverlay('p1')).toBe(2);
    expect(zodomus.getAvailability).toHaveBeenCalledTimes(2);

    await service.getInventoryOverlayForProperty(p, '2026-10-04', '2026-10-18');
    await service.getInventoryOverlayForProperty(p, '2026-10-04', '2026-10-18');
    expect(zodomus.getAvailability).toHaveBeenCalledTimes(3);
  });

  it('leaves other properties cached', async () => {
    const { service, zodomus } = buildService();
    const other = property('p2');
    await service.getInventoryOverlayForProperty(other, '2026-10-04', '2026-10-18');

    expect(service.invalidateCalendarOverlay('p1')).toBe(0);
    await service.getInventoryOverlayForProperty(other, '2026-10-04', '2026-10-18');
    expect(zodomus.getAvailability).toHaveBeenCalledTimes(1);
  });
});
