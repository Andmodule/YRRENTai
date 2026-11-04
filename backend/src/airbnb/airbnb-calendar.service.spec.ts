import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { AirbnbCalendarService, type AirbnbJob } from './airbnb-calendar.service';
import type { ZodomusAirbnbListingEntity } from './airbnb-listing.entity';

const OWNER = { sub: 'owner-1', email: 'o@example.test', role: 'OWNER' };
const PID = '46889a43-e073-46d3-8457-f03525dbb1c9';
const PILOT = '1017407411799040875';

type RateNight = { date: string; price: number | null; closed: boolean; booked: number; availability?: number | null };

function setup(
  opts: {
    enabled?: boolean;
    listing?: Partial<ZodomusAirbnbListingEntity> | null;
    ownRow?: { externalListingId: string } | null;
    elsewhereRow?: { propertyId: string } | null;
    ical?: string[];
    promos?: unknown[];
  } = {},
) {
  let listing: ZodomusAirbnbListingEntity | null = opts.listing
    ? ({ propertyId: PID, listingId: PILOT, activatedAt: null, noPriceNights: [], planEnd: null, lastSyncAt: null, lastSync: null, ...opts.listing } as ZodomusAirbnbListingEntity)
    : null;
  let listener: ((p: string, d: { date: string; free: boolean }[]) => Promise<void>) | null = null;
  const connect = { isEnabled: opts.enabled ?? true, activeHostToken: jest.fn(async () => '9851359133') };
  const rateNights = new Map<string, RateNight>();
  const dates = {
    bookingRateNights: jest.fn(async () => new Map(rateNights)),
    minPriceOf: jest.fn(async () => 160),
    addAppliedListener: jest.fn(),
    bookingChannelId: 1,
  };
  const calls: [string, Record<string, unknown>][] = [];
  const zodomus = {
    upstreamPost: jest.fn(async (path: string, body: Record<string, unknown>) => {
      calls.push([path, body]);
      return path === '/airbnb-calendar' ? { response: { success: true } } : {};
    }),
  };
  const ratesPush = { collectCrmBlockedNightKeys: jest.fn(async () => new Set<string>()), addPushedListener: jest.fn() };
  const availabilityPush = { setAfterPushListener: jest.fn((fn) => (listener = fn)) };
  const property = { id: PID, timezone: 'Europe/Warsaw', icalImportUrls: opts.ical ?? [] };
  const propertyService = { findOneForUser: jest.fn(async () => property), findByIdForAdmin: jest.fn(async () => property) };
  const listings = {
    findOne: jest.fn(async ({ where }: { where: { propertyId?: string; listingId?: string } }) =>
      listing && (where.propertyId === listing.propertyId || where.listingId === listing.listingId) ? { ...listing } : null,
    ),
    create: jest.fn((r) => r),
    save: jest.fn(async (r) => (listing = { noPriceNights: [], planEnd: null, lastSync: null, lastSyncAt: null, ...r })),
    update: jest.fn(async (_w, patch) => {
      if (listing) Object.assign(listing, patch);
    }),
  };
  const channelRows = {
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      'otaPlatformId' in where ? (opts.ownRow ?? null) : (opts.elsewhereRow ?? null),
    ),
    create: jest.fn((r) => r),
    save: jest.fn(async (r) => r),
  };
  const platforms = { findOne: jest.fn(async () => ({ id: 'plat-airbnb', code: 'airbnb', zodomusChannelId: 3 })) };
  const promotions = {
    find: jest.fn(async () =>
      opts.promos ?? [
        { stayFrom: '2000-01-01', stayTo: '2100-12-31', discountPct: 20, activeWeekdays: null, externalMeta: null, targets: [{ propertyId: PID, desiredState: 'on', state: 'on' }] },
        { stayFrom: '2000-01-01', stayTo: '2100-12-31', discountPct: 50, activeWeekdays: null, externalMeta: null, targets: [{ propertyId: PID, desiredState: 'on', state: 'error' }] },
        { stayFrom: '2000-01-01', stayTo: '2100-12-31', discountPct: 40, activeWeekdays: null, externalMeta: null, targets: [{ propertyId: 'other', desiredState: 'on', state: 'on' }] },
        { stayFrom: '2000-01-01', stayTo: '2100-12-31', discountPct: 30, activeWeekdays: null, externalMeta: { targetChannel: 'app' }, targets: [{ propertyId: PID, desiredState: 'on', state: 'on' }] },
      ],
    ),
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
  const sleeps: number[] = [];
  svc.sleep = async (ms) => {
    sleeps.push(ms);
  };
  svc.onModuleInit();
  return { svc, connect, dates, zodomus, calls, ratesPush, listings, channelRows, rateNights, sleeps, listing: () => listing, listener: () => listener! };
}

async function settle(job: AirbnbJob): Promise<AirbnbJob> {
  for (let i = 0; i < 200 && job.state === 'running'; i++) await new Promise((r) => setImmediate(r));
  return job;
}

function fillBooking(s: ReturnType<typeof setup>, price: number) {
  const start = new Date(Date.now() - 86_400_000);
  for (let i = 0; i < 370; i++) {
    const d = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    s.rateNights.set(d, { date: d, price, closed: false, booked: 0, availability: 1 });
  }
}

async function checked(s: ReturnType<typeof setup>) {
  const job = await settle(await s.svc.startCheck(OWNER, PID));
  expect(job.state).toBe('done');
  return job.plan!.fingerprint;
}

describe('AirbnbCalendarService — flag and guards', () => {
  it('every action is 503 with the flag off; nothing is read or written', async () => {
    const s = setup({ enabled: false });
    await expect(s.svc.view(OWNER, PID)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(s.svc.startCheck(OWNER, PID)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(s.svc.startConnect(OWNER, PID, 'x')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(s.svc.startSend(OWNER, PID, 'x')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await s.listener()(PID, [{ date: '2026-11-13', free: false }]);
    expect(s.zodomus.upstreamPost).not.toHaveBeenCalled();
    expect(s.listings.findOne).not.toHaveBeenCalled();
  });

  it('connect / send without a fresh check → 409, nothing sent', async () => {
    const s = setup();
    await expect(s.svc.startConnect(OWNER, PID, 'x')).rejects.toBeInstanceOf(ConflictException);
    await expect(s.svc.startSend(OWNER, PID, 'x')).rejects.toBeInstanceOf(ConflictException);
    expect(s.zodomus.upstreamPost).not.toHaveBeenCalled();
  });
});

describe('AirbnbCalendarService — check', () => {
  it('Airbnb price = Booking rack minus the biggest public Basic on Booking for this property; 366 nights + closed tail; reads only', async () => {
    const s = setup();
    fillBooking(s, 500);
    const job = await settle(await s.svc.startCheck(OWNER, PID));
    expect(job.plan).toMatchObject({ listingId: PILOT, nights: 366, forSale: 366, noPrice: 0, minPrice: 400, maxPrice: 400, operations: 2 });
    expect(job.plan!.sample[0]).toMatchObject({ availability: 'available', dailyPrice: 400 });
    expect(job.plan!.sample[1]!.availability).toBe('unavailable');
    expect(job.plan!.sample[1]!.dates[0]!.startsWith(`${job.plan!.toExclusive}:`)).toBe(true);
    expect(s.zodomus.upstreamPost).not.toHaveBeenCalled();
  });

  it('nights sold on Booking or blocked in RentAI go unavailable with their price; closed ones have no price', async () => {
    const s = setup();
    fillBooking(s, 500);
    const job0 = await settle(await s.svc.startCheck(OWNER, PID));
    const from = job0.plan!.from;
    const d1 = new Date(Date.parse(`${from}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const d2 = new Date(Date.parse(`${from}T12:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
    s.rateNights.get(from)!.booked = 1;
    s.rateNights.get(d2)!.closed = true;
    s.ratesPush.collectCrmBlockedNightKeys.mockResolvedValue(new Set([d1]));
    const job = await settle(await s.svc.startCheck(OWNER, PID));
    expect(job.plan).toMatchObject({ occupied: 2, noPrice: 1, forSale: 363 });
    expect(job.plan!.sample.slice(0, 2)).toEqual([
      { dates: [`${from}:${d1}`], availability: 'unavailable', dailyPrice: 400 },
      { dates: [`${d2}:${d2}`], availability: 'unavailable' },
    ]);
  });
});

describe('AirbnbCalendarService — connect', () => {
  it('re-checks, activates the pilot listing, sends the calendar, then adds the Airbnb channel row', async () => {
    const s = setup();
    fillBooking(s, 500);
    const fp = await checked(s);
    const job = await settle(await s.svc.startConnect(OWNER, PID, fp));
    expect(job.state).toBe('done');
    expect(s.dates.bookingRateNights).toHaveBeenCalledTimes(2);
    expect(s.calls[0]).toEqual(['/property-activation', { channelId: 3, propertyId: PILOT, priceModelId: 4, token: '9851359133' }]);
    expect(s.calls[1]![0]).toBe('/airbnb-calendar');
    expect(s.calls[1]![1]).toMatchObject({ channelId: 3, propertyId: PILOT });
    expect(s.channelRows.save).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: PID, otaPlatformId: 'plat-airbnb', externalListingId: PILOT, zodomusRoomId: `${PILOT}01` }),
    );
    expect(s.listing()).toMatchObject({ propertyId: PID, listingId: PILOT, planEnd: job.plan!.toExclusive });
    expect(s.listing()!.activatedAt).toBeInstanceOf(Date);
    expect(job.result).toMatchObject({ activated: true, sentCalls: 1, failedCalls: 0, closedAll: false });
  });

  it('a change on Booking between check and connect stops it before the activation', async () => {
    const s = setup();
    fillBooking(s, 500);
    const fp = await checked(s);
    for (const n of s.rateNights.values()) n.price = 510;
    const job = await settle(await s.svc.startConnect(OWNER, PID, fp));
    expect(job.state).toBe('failed');
    expect(job.error).toContain('изменилось');
    expect(s.zodomus.upstreamPost).not.toHaveBeenCalled();
    // The new plan is the one to connect now.
    const again = await settle(await s.svc.startConnect(OWNER, PID, job.plan!.fingerprint));
    expect(again.state).toBe('done');
  });

  it('refuses before any call: iCal from Airbnb, another Airbnb listing on the property, the pilot on another property, a held pilot, inactive host', async () => {
    const cases: [Parameters<typeof setup>[0], RegExp | typeof BadRequestException][] = [
      [{ ical: ['https://www.airbnb.com/calendar/ical/1.ics?s=x'] }, /iCal из Airbnb/],
      [{ ownRow: { externalListingId: '999' } }, /другое объявление Airbnb/],
      [{ elsewhereRow: { propertyId: 'other' } }, /другому объекту в карточке/],
      [{ listing: { propertyId: 'other', activatedAt: new Date() } }, /другому объекту/],
    ];
    for (const [o, msg] of cases) {
      const s = setup(o);
      fillBooking(s, 500);
      const fp = await checked(s);
      await expect(s.svc.startConnect(OWNER, PID, fp)).rejects.toThrow(msg as RegExp);
      expect(s.zodomus.upstreamPost).not.toHaveBeenCalled();
    }
    const s = setup();
    fillBooking(s, 500);
    s.connect.activeHostToken.mockRejectedValue(new ServiceUnavailableException('Хозяин Airbnb не подключён'));
    const fp = await checked(s);
    await expect(s.svc.startConnect(OWNER, PID, fp)).rejects.toThrow('не подключён');
    expect(s.zodomus.upstreamPost).not.toHaveBeenCalled();
  });

  it('an existing row with the pilot id is kept (not added twice); a connected listing is refused', async () => {
    const s = setup({ ownRow: { externalListingId: PILOT } });
    fillBooking(s, 500);
    await settle(await s.svc.startConnect(OWNER, PID, await checked(s)));
    expect(s.channelRows.save).not.toHaveBeenCalled();
    await expect(s.svc.startConnect(OWNER, PID, await checked(s))).rejects.toThrow('уже подключено');
  });

  it('a calendar chunk failing 3 times → the whole horizon is closed on Airbnb and nothing reopens', async () => {
    const s = setup();
    fillBooking(s, 500);
    let n = 0;
    s.zodomus.upstreamPost.mockImplementation(async (path: string, body: Record<string, unknown>) => {
      s.calls.push([path, body]);
      if (path === '/airbnb-calendar' && ++n <= 3) throw new Error('502 Airbnb');
      return path === '/airbnb-calendar' ? { response: { success: true } } : {};
    });
    const fp = await checked(s);
    const job = await settle(await s.svc.startConnect(OWNER, PID, fp));
    expect(job.state).toBe('failed');
    expect(job.result).toMatchObject({ activated: true, failedCalls: 1, closedAll: true });
    expect(job.error).toContain('закрыто на Airbnb целиком');
    const last = s.calls[s.calls.length - 1]!;
    expect(last[1].operations).toEqual([{ dates: [expect.stringMatching(new RegExp(`^${job.plan!.from}:`))], availability: 'unavailable' }]);
    expect(s.sleeps).toEqual(expect.arrayContaining([5_000, 65_000]));
    expect(s.listing()).toMatchObject({ planEnd: job.plan!.from, noPriceNights: [] });
    // The channel row is still added: Airbnb bookings must find the property.
    expect(s.channelRows.save).toHaveBeenCalled();
  });

  it('a refusal by Airbnb (success false) counts as a failure', async () => {
    const s = setup();
    fillBooking(s, 500);
    s.zodomus.upstreamPost.mockImplementation(async (path: string) => (path === '/airbnb-calendar' ? { response: { success: false } } : {}));
    const job = await settle(await s.svc.startConnect(OWNER, PID, await checked(s)));
    expect(job.state).toBe('failed');
    expect(job.result!.closedAll).toBe(false);
    expect(job.error).toContain('закройте даты на Airbnb вручную');
  });
});

describe('AirbnbCalendarService — after an availability push', () => {
  it('closes booked nights and reopens free ones (except no-price ones and past planEnd, which stay closed)', async () => {
    const s = setup({ listing: { activatedAt: new Date(), noPriceNights: ['2026-11-14'], planEnd: '2026-11-16' } });
    await s.listener()(PID, [
      { date: '2026-11-13', free: true },
      { date: '2026-11-14', free: true },
      { date: '2026-11-15', free: false },
      { date: '2026-11-16', free: true },
    ]);
    expect(s.zodomus.upstreamPost).toHaveBeenCalledTimes(1);
    expect(s.zodomus.upstreamPost).toHaveBeenCalledWith('/airbnb-calendar', {
      channelId: 3,
      propertyId: PILOT,
      operations: [
        { dates: ['2026-11-13:2026-11-13'], availability: 'available' },
        { dates: ['2026-11-14:2026-11-16'], availability: 'unavailable' },
      ],
    });
    expect(s.listing()!.lastSync).toMatchObject({ kind: 'availability', sentCalls: 1, failedCalls: 0 });
  });

  it('does nothing without a connected pilot listing', async () => {
    for (const s of [setup(), setup({ listing: { activatedAt: null, planEnd: '2027-01-01' } }), setup({ listing: { activatedAt: new Date(), listingId: '123', planEnd: '2027-01-01' } })]) {
      await s.listener()(PID, [{ date: '2026-11-13', free: false }]);
      expect(s.zodomus.upstreamPost).not.toHaveBeenCalled();
    }
  });

  it('several pushes while one is running: only the latest occupancy goes out after it', async () => {
    const s = setup({ listing: { activatedAt: new Date(), planEnd: '2027-01-01' } });
    let release!: () => void;
    s.zodomus.upstreamPost.mockImplementationOnce(
      () => new Promise((r) => (release = () => r({ response: { success: true } }) as never)) as never,
    );
    const first = s.listener()(PID, [{ date: '2026-11-13', free: false }]);
    await new Promise((r) => setImmediate(r));
    const second = s.listener()(PID, [{ date: '2026-11-13', free: true }]);
    const third = s.listener()(PID, [{ date: '2026-11-13', free: false }, { date: '2026-11-14', free: false }]);
    release();
    await Promise.all([first, second, third]);
    expect(s.zodomus.upstreamPost).toHaveBeenCalledTimes(2);
    expect((s.zodomus.upstreamPost.mock.calls[1] as unknown as [string, { operations: unknown }])[1].operations).toEqual([
      { dates: ['2026-11-13:2026-11-14'], availability: 'unavailable' },
    ]);
  });

  it('a push during a full send waits for it (never interleaves)', async () => {
    const s = setup({ listing: { activatedAt: new Date(), planEnd: '2027-01-01' } });
    fillBooking(s, 500);
    const fp = await checked(s);
    const job = await s.svc.startSend(OWNER, PID, fp);
    const pushed = s.listener()(PID, [{ date: '2026-11-13', free: false }]);
    await settle(job);
    await pushed;
    const paths = (s.zodomus.upstreamPost.mock.calls as unknown as [string, { operations: { dates: string[] }[] }][]).map((c) => c[1].operations.length);
    // full send first (366 nights + tail in one call), then the single availability operation
    expect(paths).toEqual([2, 1]);
  });

  it('a failed call is recorded after its retries, not thrown (the Booking push must not fail)', async () => {
    const s = setup({ listing: { activatedAt: new Date(), planEnd: '2027-01-01' } });
    s.zodomus.upstreamPost.mockRejectedValue(new Error('502'));
    await expect(s.listener()(PID, [{ date: '2026-11-13', free: false }])).resolves.toBeUndefined();
    expect(s.zodomus.upstreamPost).toHaveBeenCalledTimes(3);
    expect(s.listing()!.lastSync).toMatchObject({ kind: 'availability', sentCalls: 0, failedCalls: 1 });
  });
});

describe('AirbnbCalendarService — after «Открыть / закрыть продажи»', () => {
  const closed = (date: string) => ({ date, price: 300, closed: true, fromPrice: 300, fromClosed: false });
  const opened = (date: string, price = 300) => ({ date, price, closed: false, fromPrice: null, fromClosed: true });
  const ops = (s: ReturnType<typeof setup>, i: number) =>
    (s.zodomus.upstreamPost.mock.calls[i] as unknown as [string, { operations: unknown }])[1].operations;

  const drain = async (s: ReturnType<typeof setup>, n: number) => {
    for (let i = 0; i < 100 && s.zodomus.upstreamPost.mock.calls.length < n; i++) await new Promise((r) => setImmediate(r));
  };

  it('registers with the dates runs (close, open and price) and does not hold the run', async () => {
    const s = setup({ listing: { activatedAt: new Date(), planEnd: '2027-01-01' } });
    expect(s.dates.addAppliedListener).toHaveBeenCalledTimes(1);
    const fn = (s.dates.addAppliedListener.mock.calls[0] as unknown as [(...a: unknown[]) => Promise<void>])[0];
    await expect(fn(PID, 'close', [closed('2026-11-16')], [])).resolves.toBeUndefined();
    await drain(s, 1);
    expect(s.zodomus.upstreamPost).toHaveBeenCalledTimes(1);
    // a price run re-prices nights open for sale: the new Airbnb price goes out (300 − Basic 20 % = 240)
    await fn(PID, 'price', [opened('2026-11-20')], []);
    await drain(s, 2);
    expect(ops(s, 1)).toEqual([{ dates: ['2026-11-20:2026-11-20'], availability: 'available', dailyPrice: 240 }]);
  });

  it('«Цена на канале»: the pushed nights get the new Airbnb price', async () => {
    const s = setup({ listing: { activatedAt: new Date(), planEnd: '2027-01-01' } });
    expect(s.ratesPush.addPushedListener).toHaveBeenCalledTimes(1);
    const fn = (s.ratesPush.addPushedListener.mock.calls[0] as unknown as [(p: string, ch: number, n: { date: string; price: number }[]) => void])[0];
    // another channel's rate is not followed
    fn(PID, 7, [{ date: '2026-11-09', price: 999 }]);
    fn(PID, 1, [
      { date: '2026-11-09', price: 320 },
      { date: '2026-11-10', price: 320 },
    ]);
    await drain(s, 1);
    expect(s.zodomus.upstreamPost).toHaveBeenCalledTimes(1);
    expect(ops(s, 0)).toEqual([{ dates: ['2026-11-09:2026-11-10'], availability: 'available', dailyPrice: 256 }]);
  });

  it('a price run: an occupied night goes unavailable with its price, a no-price night reopens and leaves the list', async () => {
    const s = setup({ listing: { activatedAt: new Date(), planEnd: '2027-01-01', noPriceNights: ['2026-11-21'] } });
    s.ratesPush.collectCrmBlockedNightKeys.mockResolvedValueOnce(new Set(['2026-11-20']));
    const fn = (s.dates.addAppliedListener.mock.calls[0] as unknown as [(...a: unknown[]) => Promise<void>])[0];
    await fn(PID, 'price', [opened('2026-11-20'), opened('2026-11-21')], []);
    await drain(s, 1);
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    expect(ops(s, 0)).toEqual([
      { dates: ['2026-11-20:2026-11-20'], availability: 'unavailable', dailyPrice: 240 },
      { dates: ['2026-11-21:2026-11-21'], availability: 'available', dailyPrice: 240 },
    ]);
    expect(s.listing()!.noPriceNights).toEqual([]);
  });

  it('closed nights (sent and already closed) go unavailable and are remembered, no price lookups', async () => {
    const s = setup({ listing: { activatedAt: new Date(), planEnd: '2027-01-01', noPriceNights: ['2026-12-01'] } });
    await s.svc.afterDatesApplied(PID, [closed('2026-11-16'), closed('2026-11-17')], ['2026-11-18']);
    expect(s.zodomus.upstreamPost).toHaveBeenCalledWith('/airbnb-calendar', {
      channelId: 3,
      propertyId: PILOT,
      operations: [{ dates: ['2026-11-16:2026-11-18'], availability: 'unavailable' }],
    });
    expect(s.listing()!.noPriceNights).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-12-01']);
    expect(s.listing()!.lastSync).toMatchObject({ kind: 'dates', sentCalls: 1, failedCalls: 0 });
    expect(s.ratesPush.collectCrmBlockedNightKeys).not.toHaveBeenCalled();
    expect(s.dates.minPriceOf).not.toHaveBeenCalled();
  });

  it('a later booking update keeps a night closed by «закрыть» closed', async () => {
    const s = setup({ listing: { activatedAt: new Date(), planEnd: '2027-01-01' } });
    await s.svc.afterDatesApplied(PID, [closed('2026-11-16')], []);
    await s.listener()(PID, [{ date: '2026-11-16', free: true }]);
    expect(ops(s, 1)).toEqual([{ dates: ['2026-11-16:2026-11-16'], availability: 'unavailable' }]);
  });

  it('opened nights go available with the regular guest price; occupied ones stay closed', async () => {
    const s = setup({ listing: { activatedAt: new Date(), planEnd: '2027-01-01', noPriceNights: ['2026-11-16', '2026-11-17', '2026-11-18'] } });
    s.ratesPush.collectCrmBlockedNightKeys.mockResolvedValueOnce(new Set(['2026-11-18']));
    await s.svc.afterDatesApplied(PID, [opened('2026-11-16'), opened('2026-11-17'), opened('2026-11-18')], []);
    // 300 − Basic 20 % = 240 (the app-only 30 % and the deals of other properties do not count)
    expect(ops(s, 0)).toEqual([
      { dates: ['2026-11-16:2026-11-17'], availability: 'available', dailyPrice: 240 },
      { dates: ['2026-11-18:2026-11-18'], availability: 'unavailable', dailyPrice: 240 },
    ]);
    expect(s.listing()!.noPriceNights).toEqual([]);
    expect(s.ratesPush.collectCrmBlockedNightKeys).toHaveBeenCalledWith(expect.objectContaining({ id: PID }), '2026-11-16', '2026-11-19');
  });

  it('an opened night below the minimum price is sent at the minimum', async () => {
    const s = setup({ listing: { activatedAt: new Date(), planEnd: '2027-01-01' } });
    await s.svc.afterDatesApplied(PID, [opened('2026-11-16', 150)], []);
    expect(ops(s, 0)).toEqual([{ dates: ['2026-11-16:2026-11-16'], availability: 'available', dailyPrice: 160 }]);
  });

  it('nights from planEnd on are not touched (the closed tail guards them)', async () => {
    const s = setup({ listing: { activatedAt: new Date(), planEnd: '2026-11-17' } });
    await s.svc.afterDatesApplied(PID, [opened('2026-11-16'), opened('2026-11-17'), closed('2026-11-20')], []);
    expect(ops(s, 0)).toEqual([{ dates: ['2026-11-16:2026-11-16'], availability: 'available', dailyPrice: 240 }]);
    const t = setup({ listing: { activatedAt: new Date(), planEnd: '2026-11-17' } });
    await t.svc.afterDatesApplied(PID, [opened('2026-11-17')], []);
    expect(t.zodomus.upstreamPost).not.toHaveBeenCalled();
  });

  it('does nothing when off, not connected, another listing, or nothing changed', async () => {
    const cases = [
      setup({ enabled: false, listing: { activatedAt: new Date(), planEnd: '2027-01-01' } }),
      setup(),
      setup({ listing: { activatedAt: null, planEnd: '2027-01-01' } }),
      setup({ listing: { activatedAt: new Date(), listingId: '123', planEnd: '2027-01-01' } }),
    ];
    for (const s of cases) {
      await s.svc.afterDatesApplied(PID, [closed('2026-11-16')], []);
      expect(s.zodomus.upstreamPost).not.toHaveBeenCalled();
    }
    const s = setup({ listing: { activatedAt: new Date(), planEnd: '2027-01-01' } });
    await s.svc.afterDatesApplied(PID, [], []);
    expect(s.listings.findOne).not.toHaveBeenCalled();
  });

  it('a failed call still remembers the closed nights, keeps opened ones closed, is recorded, not thrown', async () => {
    const s = setup({ listing: { activatedAt: new Date(), planEnd: '2027-01-01', noPriceNights: ['2026-12-01', '2026-11-20'] } });
    s.zodomus.upstreamPost.mockRejectedValue(new Error('502'));
    await expect(
      s.svc.afterDatesApplied(PID, [closed('2026-11-16'), opened('2026-11-20')], ['2026-11-17']),
    ).resolves.toBeUndefined();
    // 2026-11-20 was opened, but Airbnb may not have it: it stays in the list (closed for later booking updates).
    expect(s.listing()!.noPriceNights).toEqual(['2026-11-16', '2026-11-17', '2026-11-20', '2026-12-01']);
    expect(s.listing()!.lastSync).toMatchObject({ kind: 'dates', sentCalls: 0, failedCalls: 1 });
    // a later booking update keeps the closed night closed
    s.zodomus.upstreamPost.mockResolvedValue({ response: { success: true } } as never);
    await s.listener()(PID, [{ date: '2026-11-16', free: true }]);
    expect(ops(s, s.zodomus.upstreamPost.mock.calls.length - 1)).toEqual([
      { dates: ['2026-11-16:2026-11-16'], availability: 'unavailable' },
    ]);
  });

  it('stops after the first failed call (no burst to Zodomus)', async () => {
    const s = setup({ listing: { activatedAt: new Date(), planEnd: '2027-01-01' } });
    s.zodomus.upstreamPost.mockRejectedValue(new Error('502'));
    // every other night → 60 separate operations → 2 chunks of 50
    const nights = Array.from({ length: 60 }, (_, i) => closed(new Date(Date.UTC(2026, 10, 10) + i * 2 * 86_400_000).toISOString().slice(0, 10)));
    await s.svc.afterDatesApplied(PID, nights, []);
    expect(s.zodomus.upstreamPost).toHaveBeenCalledTimes(3); // one chunk, its retries, no second chunk
  });

  it('lookups failing: closes still go, opened nights are sent closed without a price and stay remembered', async () => {
    const s = setup({ listing: { activatedAt: new Date(), planEnd: '2027-01-01' } });
    s.dates.minPriceOf.mockRejectedValueOnce(new Error('db down'));
    await s.svc.afterDatesApplied(PID, [closed('2026-11-16'), opened('2026-11-18')], []);
    expect(ops(s, 0)).toEqual([
      { dates: ['2026-11-16:2026-11-16'], availability: 'unavailable' },
      { dates: ['2026-11-18:2026-11-18'], availability: 'unavailable' },
    ]);
    expect(s.listing()!.noPriceNights).toEqual(['2026-11-16', '2026-11-18']);
    // a booking update does not open it at an undiscounted price
    await s.listener()(PID, [{ date: '2026-11-18', free: true }]);
    expect(ops(s, 1)).toEqual([{ dates: ['2026-11-18:2026-11-18'], availability: 'unavailable' }]);
  });

  it('waits for a running full send of the property (never interleaves)', async () => {
    const s = setup({ listing: { activatedAt: new Date(), planEnd: '2027-01-01' } });
    fillBooking(s, 500);
    const fp = await checked(s);
    const job = await s.svc.startSend(OWNER, PID, fp);
    const dates = s.svc.afterDatesApplied(PID, [closed('2026-11-16')], []);
    await settle(job);
    await dates;
    const sizes = (s.zodomus.upstreamPost.mock.calls as unknown as [string, { operations: unknown[] }][]).map((c) => c[1].operations.length);
    expect(sizes).toEqual([2, 1]);
  });
});

describe('AirbnbCalendarService — page helpers', () => {
  it('freshPlan: the last check while fresh, none while a job runs or after 15 minutes', async () => {
    const s = setup();
    fillBooking(s, 500);
    expect((await s.svc.view(OWNER, PID)).freshPlan).toBeNull();
    const fp = await checked(s);
    const v = await s.svc.view(OWNER, PID);
    expect(v.freshPlan).toMatchObject({ fingerprint: fp });
    expect(Date.parse(v.freshPlan!.expiresAt) - Date.parse(v.freshPlan!.checkedAt)).toBe(15 * 60_000);
    const realNow = Date.now;
    Date.now = () => realNow() + 15 * 60_000 + 1;
    try {
      expect((await s.svc.view(OWNER, PID)).freshPlan).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it('connectedProperty: the property holding the pilot listing, if it is the user\'s', async () => {
    expect(await setup().svc.connectedProperty(OWNER)).toEqual({ propertyId: null });
    expect(await setup({ listing: { activatedAt: new Date() } }).svc.connectedProperty(OWNER)).toEqual({ propertyId: PID });
    await expect(setup({ enabled: false }).svc.connectedProperty(OWNER)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
