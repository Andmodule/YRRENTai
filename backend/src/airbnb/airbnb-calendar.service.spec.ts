import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { AirbnbCalendarService, type AirbnbJob } from './airbnb-calendar.service';
import type { ZodomusAirbnbListingEntity } from './airbnb-listing.entity';

const OWNER = { sub: 'owner-1', email: 'o@example.test', role: 'OWNER' };
const PID = '46889a43-e073-46d3-8457-f03525dbb1c9';
const PILOT = '1017407411799040875';

function setup(opts: { enabled?: boolean; listing?: Partial<ZodomusAirbnbListingEntity> | null; channelRow?: boolean } = {}) {
  let listing: ZodomusAirbnbListingEntity | null = opts.listing
    ? ({ propertyId: PID, listingId: PILOT, activatedAt: null, noPriceNights: [], lastSyncAt: null, lastSync: null, ...opts.listing } as ZodomusAirbnbListingEntity)
    : null;
  let listener: ((p: string, d: { date: string; free: boolean }[]) => Promise<void>) | null = null;
  const connect = { isEnabled: opts.enabled ?? true, activeHostToken: jest.fn(async () => '9851359133') };
  const rateNights = new Map<string, { date: string; price: number | null; closed: boolean; booked: number; availability?: number | null }>();
  const dates = {
    bookingRateNights: jest.fn(async () => rateNights),
    minPriceOf: jest.fn(async () => 160),
  };
  const zodomus = { upstreamPost: jest.fn(async (path: string) => (path === '/airbnb-calendar' ? { response: { success: true } } : {})) };
  const ratesPush = { collectCrmBlockedNightKeys: jest.fn(async () => new Set<string>()) };
  const availabilityPush = { setAfterPushListener: jest.fn((fn) => (listener = fn)) };
  const property = { id: PID, timezone: 'Europe/Warsaw' };
  const propertyService = { findOneForUser: jest.fn(async () => property) };
  const listings = {
    findOne: jest.fn(async ({ where }: { where: { propertyId?: string; listingId?: string } }) =>
      listing && (where.propertyId === listing.propertyId || where.listingId === listing.listingId) ? listing : null,
    ),
    create: jest.fn((r) => r),
    save: jest.fn(async (r) => (listing = { noPriceNights: [], lastSync: null, lastSyncAt: null, ...r })),
    update: jest.fn(async (_w, patch) => {
      if (listing) Object.assign(listing, patch);
    }),
  };
  const channelRows = {
    findOne: jest.fn(async () => (opts.channelRow ? { id: 'row' } : null)),
    create: jest.fn((r) => r),
    save: jest.fn(async (r) => r),
  };
  const platforms = { findOne: jest.fn(async () => ({ id: 'plat-airbnb', code: 'airbnb', zodomusChannelId: 3 })) };
  const promotions = {
    find: jest.fn(async () => [
      { stayFrom: '2000-01-01', stayTo: '2100-12-31', discountPct: 20, activeWeekdays: null, targets: [{ propertyId: PID, desiredState: 'on', state: 'on' }] },
      { stayFrom: '2000-01-01', stayTo: '2100-12-31', discountPct: 50, activeWeekdays: null, targets: [{ propertyId: PID, desiredState: 'on', state: 'error' }] },
      { stayFrom: '2000-01-01', stayTo: '2100-12-31', discountPct: 40, activeWeekdays: null, targets: [{ propertyId: 'other', desiredState: 'on', state: 'on' }] },
    ]),
  };
  const svc = new AirbnbCalendarService(
    connect as never,
    dates as never,
    zodomus as never,
    ratesPush as never,
    availabilityPush as never,
    propertyService as never,
    listings as never,
    channelRows as never,
    platforms as never,
    promotions as never,
  );
  svc.onModuleInit();
  return { svc, connect, dates, zodomus, ratesPush, listings, channelRows, rateNights, listing: () => listing, listener: () => listener! };
}

async function settle(job: AirbnbJob): Promise<AirbnbJob> {
  for (let i = 0; i < 50 && job.state === 'running'; i++) await new Promise((r) => setImmediate(r));
  return job;
}

function fillBooking(s: ReturnType<typeof setup>, price: number) {
  const start = new Date();
  for (let i = 0; i < 366; i++) {
    const d = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    s.rateNights.set(d, { date: d, price, closed: false, booked: 0, availability: 1 });
  }
}

describe('AirbnbCalendarService — flag and guards', () => {
  it('every action is 503 with the flag off; nothing is read or written', async () => {
    const s = setup({ enabled: false });
    await expect(s.svc.view(OWNER, PID)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(s.svc.startCheck(OWNER, PID)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(s.svc.startConnect(OWNER, PID, 'x')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(s.svc.startSend(OWNER, PID, 'x')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(s.zodomus.upstreamPost).not.toHaveBeenCalled();
  });

  it('connect / send without a fresh check → 409, nothing sent', async () => {
    const s = setup();
    await expect(s.svc.startConnect(OWNER, PID, 'x')).rejects.toBeInstanceOf(ConflictException);
    await expect(s.svc.startSend(OWNER, PID, 'x')).rejects.toBeInstanceOf(ConflictException);
    expect(s.zodomus.upstreamPost).not.toHaveBeenCalled();
  });
});

describe('AirbnbCalendarService — check', () => {
  it('Airbnb price = Booking rack minus the biggest Basic that is on Booking for this property; reads only', async () => {
    const s = setup();
    fillBooking(s, 500);
    const job = await settle(await s.svc.startCheck(OWNER, PID));
    expect(job.state).toBe('done');
    expect(job.plan).toMatchObject({ listingId: PILOT, nights: 365, forSale: 365, noPrice: 0, minPrice: 400, maxPrice: 400, operations: 1 });
    expect(job.plan!.sample[0]).toMatchObject({ availability: 'available', dailyPrice: 400 });
    expect(s.zodomus.upstreamPost).not.toHaveBeenCalled();
  });

  it('nights sold on Booking or blocked in RentAI go unavailable; closed ones count as no price', async () => {
    const s = setup();
    fillBooking(s, 500);
    const [d0, d1, d2] = [...s.rateNights.keys()];
    s.rateNights.get(d0!)!.booked = 1;
    s.rateNights.get(d2!)!.closed = true;
    s.ratesPush.collectCrmBlockedNightKeys.mockResolvedValue(new Set([d1!]));
    const job = await settle(await s.svc.startCheck(OWNER, PID));
    expect(job.plan).toMatchObject({ occupied: 2, noPrice: 1, forSale: 362 });
    expect(job.plan!.sample[0]).toEqual({ dates: [`${d0}:${d2}`], availability: 'unavailable' });
  });
});

describe('AirbnbCalendarService — connect', () => {
  it('activates the pilot listing, adds the Airbnb channel row, then sends the checked calendar', async () => {
    const s = setup();
    fillBooking(s, 500);
    const check = await settle(await s.svc.startCheck(OWNER, PID));
    const job = await settle(await s.svc.startConnect(OWNER, PID, check.plan!.fingerprint));
    expect(job.state).toBe('done');
    const calls = s.zodomus.upstreamPost.mock.calls as unknown as [string, Record<string, unknown>][];
    expect(calls[0]).toEqual(['/property-activation', { channelId: 3, propertyId: PILOT, priceModelId: 4, token: '9851359133' }]);
    expect(calls[1]![0]).toBe('/airbnb-calendar');
    expect(calls[1]![1]).toMatchObject({ channelId: 3, propertyId: PILOT });
    expect(s.channelRows.save).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: PID, otaPlatformId: 'plat-airbnb', externalListingId: PILOT, zodomusRoomId: `${PILOT}01` }),
    );
    expect(s.listing()).toMatchObject({ propertyId: PID, listingId: PILOT });
    expect(s.listing()!.activatedAt).toBeInstanceOf(Date);
    expect(job.result).toMatchObject({ activated: true, sentCalls: 1, failedCalls: 0 });
  });

  it('an existing channel row is not added twice; an already connected listing is refused', async () => {
    const s = setup({ channelRow: true });
    fillBooking(s, 500);
    const check = await settle(await s.svc.startCheck(OWNER, PID));
    await settle(await s.svc.startConnect(OWNER, PID, check.plan!.fingerprint));
    expect(s.channelRows.save).not.toHaveBeenCalled();
    const again = await settle(await s.svc.startCheck(OWNER, PID));
    await expect(s.svc.startConnect(OWNER, PID, again.plan!.fingerprint)).rejects.toThrow('уже подключено');
  });

  it('the pilot listing held by another property is refused before any call', async () => {
    const s = setup({ listing: { propertyId: 'other-property', activatedAt: new Date() } });
    fillBooking(s, 500);
    const check = await settle(await s.svc.startCheck(OWNER, PID));
    await expect(s.svc.startConnect(OWNER, PID, check.plan!.fingerprint)).rejects.toThrow('другому объекту');
    expect(s.zodomus.upstreamPost).not.toHaveBeenCalled();
  });

  it('a host that is not active stops the connect before any call', async () => {
    const s = setup();
    fillBooking(s, 500);
    s.connect.activeHostToken.mockRejectedValue(new ServiceUnavailableException('Хозяин Airbnb не подключён'));
    const check = await settle(await s.svc.startCheck(OWNER, PID));
    await expect(s.svc.startConnect(OWNER, PID, check.plan!.fingerprint)).rejects.toThrow('не подключён');
    expect(s.zodomus.upstreamPost).not.toHaveBeenCalled();
  });

  it('a wrong fingerprint is refused', async () => {
    const s = setup();
    fillBooking(s, 500);
    await settle(await s.svc.startCheck(OWNER, PID));
    await expect(s.svc.startConnect(OWNER, PID, 'not-it')).rejects.toThrow('изменился');
  });

  it('a calendar refused by Airbnb (success false) fails the job, the listing stays connected', async () => {
    const s = setup();
    fillBooking(s, 500);
    s.zodomus.upstreamPost.mockImplementation(async (path: string) => (path === '/airbnb-calendar' ? { response: { success: false } } : {}));
    const check = await settle(await s.svc.startCheck(OWNER, PID));
    const job = await settle(await s.svc.startConnect(OWNER, PID, check.plan!.fingerprint));
    expect(job.state).toBe('failed');
    expect(job.result).toMatchObject({ activated: true, sentCalls: 0, failedCalls: 1 });
    expect(s.listing()!.activatedAt).toBeInstanceOf(Date);
  });
});

describe('AirbnbCalendarService — after an availability push', () => {
  it('closes booked nights and reopens free ones (except no-price nights) on the connected pilot listing', async () => {
    const s = setup({ listing: { activatedAt: new Date(), noPriceNights: ['2026-11-14'] } });
    await s.listener()(PID, [
      { date: '2026-11-13', free: true },
      { date: '2026-11-14', free: true },
      { date: '2026-11-15', free: false },
    ]);
    expect(s.zodomus.upstreamPost).toHaveBeenCalledTimes(1);
    expect(s.zodomus.upstreamPost).toHaveBeenCalledWith('/airbnb-calendar', {
      channelId: 3,
      propertyId: PILOT,
      operations: [
        { dates: ['2026-11-13:2026-11-13'], availability: 'available' },
        { dates: ['2026-11-14:2026-11-15'], availability: 'unavailable' },
      ],
    });
    expect(s.listing()!.lastSync).toMatchObject({ kind: 'availability', sentCalls: 1, failedCalls: 0 });
  });

  it('does nothing for a property without a connected listing, with the flag off, or for a non-pilot id', async () => {
    for (const s of [setup(), setup({ listing: { activatedAt: null } }), setup({ enabled: false, listing: { activatedAt: new Date() } }), setup({ listing: { activatedAt: new Date(), listingId: '123' } })]) {
      await s.listener()(PID, [{ date: '2026-11-13', free: false }]);
      expect(s.zodomus.upstreamPost).not.toHaveBeenCalled();
    }
  });

  it('a failed call is recorded, not thrown (the Booking push must not fail)', async () => {
    const s = setup({ listing: { activatedAt: new Date() } });
    s.zodomus.upstreamPost.mockRejectedValue(new Error('502'));
    await expect(s.listener()(PID, [{ date: '2026-11-13', free: false }])).resolves.toBeUndefined();
    expect(s.listing()!.lastSync).toMatchObject({ kind: 'availability', sentCalls: 0, failedCalls: 1 });
  });
});
