import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import type { PropertyEntity } from '../property/entities/property.entity';
import type { PropertyService } from '../property/property.service';
import type { PropertyPricingSettingsEntity } from '../pricing/entities/property-pricing-settings.entity';
import type { ZodomusService } from '../integrations/zodomus/zodomus.service';
import type { ZodomusSyncService } from '../integrations/zodomus/zodomus-sync.service';
import type { ZodomusRatesPushService } from '../integrations/zodomus/zodomus-rates-push.service';
import { CalendarDatesService, type CalendarDatesJob } from './calendar-dates.service';
import { addDaysYmd, nightKeys } from './calendar-dates.util';

const PROPERTY_ID = '46889a43-e073-46d3-8457-f03525dbb1c9';
const EXT = '11021398';
const ROOM = '1102139801';
const RATE = '39993723';
const USER: JwtPayload = { sub: 'u1', email: 'a@b.c', role: 'OWNER' };

type Night = { closed: boolean; price: number; booked: number };

/** A tiny Booking: GET /availability reads it, POST /rates writes it. */
function fakeBooking(initial: Record<string, Night>) {
  const state = new Map(Object.entries(initial));
  const getAvailability = jest.fn(async (_ch: number, _ext: string, from: string, to: string) => ({
    rooms: [
      {
        id: ROOM,
        dates: nightKeys(from, to)
          .filter((d) => state.has(d))
          .map((d) => {
            const n = state.get(d)!;
            return {
              date: d,
              availability: '1',
              booked: '',
              rates: [{ rateId: RATE, closed: n.closed ? '1' : '0', price: n.price.toFixed(1), booked: String(n.booked) }],
            };
          }),
      },
    ],
  }));
  const setRates = jest.fn(async (p: { dateFrom: string; dateToExclusive: string; price: number | string; closed?: boolean }): Promise<unknown> => {
    for (const d of nightKeys(p.dateFrom, p.dateToExclusive)) {
      const n = state.get(d) ?? { closed: true, price: 0, booked: 0 };
      state.set(d, { ...n, price: Number(p.price), closed: p.closed ?? n.closed });
    }
    return { status: { returnCode: 200 } };
  });
  return { state, getAvailability, setRates };
}

function closedNights(from: string, to: string, price = 1180): Record<string, Night> {
  return Object.fromEntries(nightKeys(from, to).map((d) => [d, { closed: true, price, booked: 0 }]));
}

function setup(opts: {
  nights?: Record<string, Night>;
  env?: Record<string, unknown>;
  minPriceMinor?: number | null;
  targets?: unknown[];
  crmBlocked?: string[];
  /** Rooms GET /room-rates returns. */
  rooms?: number;
} = {}) {
  const booking = fakeBooking(opts.nights ?? closedNights('2026-11-01', '2026-11-08'));
  const env: Record<string, unknown> = { ZODOMUS_CALENDAR_DATES_ENABLED: true, ...opts.env };
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  const zodomus = {
    isEnabled: true,
    getAvailability: booking.getAvailability,
    setRates: booking.setRates,
    getRoomRatesRaw: jest.fn().mockResolvedValue({
      rooms: Array.from({ length: opts.rooms ?? 1 }, (_, i) => ({
        id: i === 0 ? ROOM : `${ROOM}${i}`,
        rates: [{ id: RATE, name: 'Standard Rate' }],
      })),
    }),
  } as unknown as ZodomusService;
  const ratesPush = {
    buildPushTargets: jest.fn().mockReturnValue(opts.targets ?? [{ channelId: 1, extProp: EXT, storedRoomId: ROOM }]),
    resolveRoomId: jest.fn().mockResolvedValue(ROOM),
    collectCrmBlockedNightKeys: jest.fn().mockResolvedValue(new Set(opts.crmBlocked ?? [])),
  } as unknown as ZodomusRatesPushService;
  const sync = { invalidateCalendarOverlay: jest.fn() } as unknown as ZodomusSyncService;
  const propertyService = { findOneForUser: jest.fn().mockResolvedValue({ id: PROPERTY_ID }) } as unknown as PropertyService;
  const propertyRepo = {
    findOne: jest.fn().mockResolvedValue({ id: PROPERTY_ID, name: 'K22 Andersa', timezone: 'Europe/Warsaw', currency: 'PLN', channelListings: [] }),
  } as unknown as Repository<PropertyEntity>;
  const settingsRepo = {
    findOne: jest.fn().mockResolvedValue(opts.minPriceMinor != null ? { minPriceMinor: opts.minPriceMinor } : null),
  } as unknown as Repository<PropertyPricingSettingsEntity>;
  const svc = new CalendarDatesService(config, zodomus, ratesPush, sync, propertyService, propertyRepo, settingsRepo);
  return { svc, booking, sync, ratesPush, propertyService };
}

const OPEN = {
  propertyId: PROPERTY_ID,
  action: 'open' as const,
  dateFrom: '2026-11-01',
  dateToExclusive: '2026-11-08',
};

async function finished(svc: CalendarDatesService): Promise<CalendarDatesJob> {
  for (let i = 0; i < 200; i++) {
    const job = await svc.job(USER, PROPERTY_ID);
    if (job && job.state !== 'running') return job;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error('run did not finish');
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-10-12T10:00:00Z'), doNotFake: ['setImmediate', 'setTimeout', 'setInterval', 'nextTick', 'queueMicrotask'] });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('CalendarDatesService — switch and checks', () => {
  it('answers 503 while the flag is off, and when Zodomus is off', async () => {
    const { svc } = setup({ env: { ZODOMUS_CALENDAR_DATES_ENABLED: false } });
    expect(svc.enabled).toBe(false);
    await expect(svc.preview(USER, OPEN)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(svc.start(USER, OPEN)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(svc.job(USER, PROPERTY_ID)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('checks the user may see the property', async () => {
    const { svc, propertyService } = setup();
    (propertyService.findOneForUser as jest.Mock).mockRejectedValueOnce(new Error('Property not found'));
    await expect(svc.preview(USER, OPEN)).rejects.toThrow('Property not found');
  });

  it('refuses a property that is not on Booking', async () => {
    const { svc } = setup({ targets: [{ channelId: 3, extProp: 'airbnb', storedRoomId: null }] });
    await expect(svc.preview(USER, OPEN)).rejects.toThrow('не подключён к Booking');
  });

  it('refuses past dates but accepts today (property time zone)', async () => {
    const { svc } = setup({ nights: closedNights('2026-10-11', '2026-10-14') });
    await expect(svc.preview(USER, { ...OPEN, dateFrom: '2026-10-11', dateToExclusive: '2026-10-13' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const p = await svc.preview(USER, { ...OPEN, dateFrom: '2026-10-12', dateToExclusive: '2026-10-14' });
    expect(p.changes.open).toBe(2);
  });

  it('refuses more than 366 nights, accepts exactly 366', async () => {
    const { svc } = setup({ nights: {}, env: { ZODOMUS_AVAILABILITY_HORIZON_DAYS: 800 } });
    await expect(
      svc.preview(USER, { ...OPEN, dateFrom: '2026-11-01', dateToExclusive: addDaysYmd('2026-11-01', 367) }),
    ).rejects.toThrow('366');
    const p = await svc.preview(USER, { ...OPEN, dateFrom: '2026-11-01', dateToExclusive: addDaysYmd('2026-11-01', 366) });
    expect(p.nights).toBe(366);
  });

  it('refuses dates that are not real dates without looping over them', async () => {
    const { svc, booking } = setup();
    for (const dateToExclusive of ['9999-99-99', '2999-99-99', '2026-02-30', '2026-13-01']) {
      await expect(svc.preview(USER, { ...OPEN, dateToExclusive })).rejects.toThrow('Неверные даты');
    }
    await expect(svc.preview(USER, { ...OPEN, dateFrom: '2026-11-05', dateToExclusive: '2026-11-05' })).rejects.toThrow('Неверные даты');
    expect(booking.getAvailability).not.toHaveBeenCalled();
  });

  it('never opens beyond the availability horizon (RentAI would not close a later booking there)', async () => {
    const { svc } = setup({ nights: closedNights('2026-11-01', '2026-11-08'), env: { ZODOMUS_AVAILABILITY_HORIZON_DAYS: 25 } });
    // today 2026-10-12 + 25 → the last night allowed is 2026-11-05
    await expect(svc.preview(USER, { ...OPEN, dateToExclusive: '2026-11-07' })).rejects.toThrow('2026-11-05');
    await expect(svc.preview(USER, { ...OPEN, dateToExclusive: '2026-11-06' })).resolves.toBeDefined();
  });

  it('refuses a Booking property with several rooms and no saved room', async () => {
    const { svc } = setup({ targets: [{ channelId: 1, extProp: EXT, storedRoomId: null }], rooms: 2 });
    await expect(svc.preview(USER, OPEN)).rejects.toThrow('несколько номеров');
    const saved = setup({ targets: [{ channelId: 1, extProp: EXT, storedRoomId: ROOM }], rooms: 2 });
    await expect(saved.svc.preview(USER, OPEN)).resolves.toBeDefined();
    const single = setup({ targets: [{ channelId: 1, extProp: EXT, storedRoomId: null }], rooms: 1 });
    await expect(single.svc.preview(USER, OPEN)).resolves.toBeDefined();
  });

  it('refuses an open price below the minimum price, also on weekends; keeping prices is allowed', async () => {
    const { svc } = setup({ minPriceMinor: 16000 });
    await expect(svc.preview(USER, { ...OPEN, price: 150 })).rejects.toThrow('ниже минимальной');
    await expect(svc.preview(USER, { ...OPEN, price: 200, weekendPrice: 159 })).rejects.toThrow('ниже минимальной');
    await expect(svc.preview(USER, { ...OPEN, price: 160 })).resolves.toBeDefined();
    await expect(svc.preview(USER, OPEN)).resolves.toBeDefined();
  });

  it('«as on Booking» skips closed nights whose Booking price is below the minimum', async () => {
    const nights = closedNights('2026-11-01', '2026-11-04', 100);
    nights['2026-11-03'] = { closed: true, price: 500, booked: 0 };
    const { svc, booking } = setup({ nights, minPriceMinor: 30000 });
    const p = await svc.preview(USER, { ...OPEN, dateToExclusive: '2026-11-04' });
    expect(p.changes.open).toBe(1);
    expect(p.skipped.belowMin).toBe(2);
    await svc.start(USER, { ...OPEN, dateToExclusive: '2026-11-04' });
    await finished(svc);
    expect(booking.setRates.mock.calls.map((c) => c[0].dateFrom)).toEqual(['2026-11-03']);
  });
});

describe('CalendarDatesService — preview', () => {
  it('reads Booking window by window and writes nothing', async () => {
    const { svc, booking } = setup({ nights: closedNights('2026-11-01', '2027-01-10') });
    const p = await svc.preview(USER, { ...OPEN, dateToExclusive: '2027-01-10', price: 1180 });
    expect(booking.setRates).not.toHaveBeenCalled();
    expect(booking.getAvailability).toHaveBeenCalledTimes(3); // 70 nights → 28 + 28 + 14
    expect(p.changes).toEqual({ open: 70, close: 0, price: 0 });
    expect(p.requests).toBe(3);
    expect(p.rate).toEqual({ id: RATE, name: 'Standard Rate' });
    expect(p.currency).toBe('PLN');
    expect(p.tooMany).toBe(false);
    expect(p.estimateSeconds).toBeGreaterThan(0);
  });

  it('reports skipped nights by reason', async () => {
    const nights = closedNights('2026-11-01', '2026-11-08');
    nights['2026-11-03'] = { closed: true, price: 1180, booked: 1 };
    delete nights['2026-11-05'];
    const { svc } = setup({ nights, crmBlocked: ['2026-11-02'] });
    const p = await svc.preview(USER, OPEN);
    expect(p.skipped).toMatchObject({ crm: 1, booked: 1, missing: 1 });
    expect(p.changes.open).toBe(4);
  });

  it('flags a run with too many different prices', async () => {
    const nights: Record<string, Night> = {};
    nightKeys('2026-11-01', addDaysYmd('2026-11-01', 300)).forEach((d, i) => {
      nights[d] = { closed: true, price: 500 + (i % 2), booked: 0 };
    });
    const { svc } = setup({ nights });
    const input = { ...OPEN, dateToExclusive: addDaysYmd('2026-11-01', 300) };
    const p = await svc.preview(USER, input);
    expect(p.requests).toBe(300);
    expect(p.tooMany).toBe(true);
    expect(p.ranges).toHaveLength(10);
    await expect(svc.start(USER, input)).rejects.toThrow('Слишком много');
  });
});

describe('CalendarDatesService — run', () => {
  it('opens the nights, reads them back and refreshes the calendar', async () => {
    const { svc, booking, sync } = setup();
    const started = await svc.start(USER, { ...OPEN, price: 1000, weekendPrice: 1180 });
    expect(started.state).toBe('running');
    const job = await finished(svc);
    expect(job.state).toBe('done');
    expect(job.sent).toBe(job.total);
    expect(job.verify).toEqual({ checked: 7, mismatched: [] });
    expect(booking.setRates.mock.calls.map((c) => [c[0].dateFrom, c[0].dateToExclusive, c[0].price, c[0].closed])).toEqual([
      ['2026-11-01', '2026-11-06', 1000, false],
      ['2026-11-06', '2026-11-08', 1180, false],
    ]);
    expect(booking.setRates.mock.calls[0]![0]).toMatchObject({ channelId: 1, propertyId: EXT, roomId: ROOM, rateId: RATE, currencyCode: 'PLN' });
    expect(booking.state.get('2026-11-01')).toEqual({ closed: false, price: 1000, booked: 0 });
    expect(sync.invalidateCalendarOverlay).toHaveBeenCalledWith(PROPERTY_ID);
    expect(job.applied).toEqual({ open: 7, close: 0, price: 0 });
  });

  it('closing nights that are closed already sends nothing but tells the listener', async () => {
    const nights = closedNights('2026-11-01', '2026-11-03');
    nights['2026-11-03'] = { closed: false, price: 400, booked: 0 };
    const { svc, booking } = setup({ nights });
    const listener = jest.fn().mockResolvedValue(undefined);
    svc.setAppliedListener(listener);
    const p = await svc.preview(USER, { ...OPEN, action: 'close', dateToExclusive: '2026-11-04' });
    expect(p).toMatchObject({ alreadyClosed: 2, changes: { open: 0, close: 1, price: 0 }, propertyName: 'K22 Andersa' });
    await svc.start(USER, { ...OPEN, action: 'close', dateToExclusive: '2026-11-04' });
    await finished(svc);
    expect(booking.setRates).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(PROPERTY_ID, 'close', [expect.objectContaining({ date: '2026-11-03' })], ['2026-11-01', '2026-11-02']);
  });

  it('closing only closed nights still reaches the listener (nothing to send)', async () => {
    const { svc, booking } = setup({ nights: closedNights('2026-11-01', '2026-11-03') });
    const listener = jest.fn().mockResolvedValue(undefined);
    svc.setAppliedListener(listener);
    await svc.start(USER, { ...OPEN, action: 'close', dateToExclusive: '2026-11-03' });
    const job = await finished(svc);
    expect(job).toMatchObject({ state: 'done', total: 0 });
    expect(booking.setRates).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledWith(PROPERTY_ID, 'close', [], ['2026-11-01', '2026-11-02']);
  });

  it('leaves nights with no room for sale (availability 0) alone', async () => {
    const { svc, booking } = setup();
    booking.getAvailability.mockImplementationOnce(async () => ({
      rooms: [
        {
          id: ROOM,
          dates: [
            { date: '2026-11-01', availability: '0', booked: '', rates: [{ rateId: RATE, closed: '1', price: '1180', booked: '0' }] },
            { date: '2026-11-02', availability: '1', booked: '', rates: [{ rateId: RATE, closed: '1', price: '1180', booked: '0' }] },
          ],
        },
      ],
    }));
    const p = await svc.preview(USER, { ...OPEN, dateToExclusive: '2026-11-03' });
    expect(p.changes.open).toBe(1);
    expect(p.skipped.booked).toBe(1);
  });

  it('closes nights keeping their price', async () => {
    const nights = Object.fromEntries(nightKeys('2026-11-01', '2026-11-04').map((d, i) => [d, { closed: false, price: 300 + i, booked: 0 }]));
    const { svc, booking } = setup({ nights });
    await svc.start(USER, { ...OPEN, action: 'close', dateToExclusive: '2026-11-04' });
    const job = await finished(svc);
    expect(job.changes).toEqual({ open: 0, close: 3, price: 0 });
    expect(booking.setRates.mock.calls.map((c) => [c[0].price, c[0].closed])).toEqual([
      [300, true],
      [301, true],
      [302, true],
    ]);
    expect(job.verify?.mismatched).toEqual([]);
  });

  it('reuses the windows read by the preview, but reads fresh to verify', async () => {
    const { svc, booking } = setup();
    await svc.preview(USER, OPEN);
    expect(booking.getAvailability).toHaveBeenCalledTimes(1);
    await svc.start(USER, OPEN);
    await finished(svc);
    expect(booking.getAvailability).toHaveBeenCalledTimes(2); // + the read-back
  });

  it('finishes at once when there is nothing to change', async () => {
    const nights = Object.fromEntries(nightKeys('2026-11-01', '2026-11-08').map((d) => [d, { closed: false, price: 400, booked: 0 }]));
    const { svc, booking, sync } = setup({ nights });
    await svc.start(USER, { ...OPEN, price: 400 });
    const job = await finished(svc);
    expect(job).toMatchObject({ state: 'done', total: 0, sent: 0, verify: null });
    expect(booking.setRates).not.toHaveBeenCalled();
    expect(sync.invalidateCalendarOverlay).not.toHaveBeenCalled();
  });

  it('reports nights Booking did not take', async () => {
    const { svc, booking } = setup();
    booking.setRates.mockImplementation(async () => ({ status: { returnCode: 200 } })); // accepted, nothing changes
    await svc.start(USER, OPEN);
    const job = await finished(svc);
    expect(job.state).toBe('done');
    expect(job.verify?.mismatched).toHaveLength(7);
  });

  it('keeps going after a failed request and reports it', async () => {
    const { svc, booking } = setup();
    const real = booking.setRates.getMockImplementation()!;
    booking.setRates.mockImplementationOnce(async () => {
      throw new Error('Zodomus upstream error');
    });
    booking.setRates.mockImplementation(real);
    await svc.start(USER, { ...OPEN, price: 1000, weekendPrice: 1180 });
    const job = await finished(svc);
    expect(job.state).toBe('done');
    expect(job.sent).toBe(1);
    expect(job.failed).toEqual([{ dateFrom: '2026-11-01', dateToExclusive: '2026-11-06', detail: expect.any(String) }]);
    expect(job.verify?.checked).toBe(2); // only the nights that were sent
  });

  it('stops after three failed requests in a row', async () => {
    const nights: Record<string, Night> = {};
    nightKeys('2026-11-01', '2026-11-11').forEach((d, i) => {
      nights[d] = { closed: true, price: 500 + i, booked: 0 };
    });
    const { svc, booking } = setup({ nights });
    booking.setRates.mockRejectedValue(new Error('down'));
    await svc.start(USER, { ...OPEN, dateToExclusive: '2026-11-11' });
    const job = await finished(svc);
    expect(job.state).toBe('stopped');
    expect(booking.setRates).toHaveBeenCalledTimes(3);
    expect(job.total).toBe(10);
    expect(job.verify).toBeNull();
  });

  it('marks a run failed when nothing was sent', async () => {
    const { svc, booking } = setup();
    booking.setRates.mockRejectedValue(new Error('down'));
    await svc.start(USER, { ...OPEN, dateToExclusive: '2026-11-02' });
    expect((await finished(svc)).state).toBe('failed');
  });

  it('refuses a second run for the same property while one is going', async () => {
    const { svc, booking } = setup();
    let release!: () => void;
    booking.setRates.mockImplementationOnce(() => new Promise((r) => (release = () => r({}))));
    await svc.start(USER, OPEN);
    await new Promise((r) => setImmediate(r));
    expect(svc.isBusy(PROPERTY_ID)).toBe(true);
    await expect(svc.start(USER, OPEN)).rejects.toBeInstanceOf(ConflictException);
    release();
    await finished(svc);
    expect(svc.isBusy(PROPERTY_ID)).toBe(false);
  });

  it('tells the listener which nights Booking accepted', async () => {
    const { svc } = setup();
    const listener = jest.fn().mockResolvedValue(undefined);
    svc.setAppliedListener(listener);
    await svc.start(USER, { ...OPEN, action: 'open', dateToExclusive: '2026-11-03' });
    await finished(svc);
    expect(listener).toHaveBeenCalledWith(
      PROPERTY_ID,
      'open',
      [expect.objectContaining({ date: '2026-11-01', closed: false }), expect.objectContaining({ date: '2026-11-02', closed: false })],
      [],
    );
  });

  it('a failing listener does not break the run', async () => {
    const { svc } = setup();
    svc.setAppliedListener(jest.fn().mockRejectedValue(new Error('db down')));
    await svc.start(USER, OPEN);
    expect((await finished(svc)).state).toBe('done');
  });

  it('shows no report for a property that never ran', async () => {
    const { svc } = setup();
    expect(await svc.job(USER, PROPERTY_ID)).toBeNull();
  });
});

describe('CalendarDatesService — auto-extension run', () => {
  const AUTO = { action: 'open' as const, dateFrom: '2026-11-01', dateToExclusive: '2026-11-08', price: 1180, onlyClosed: true };

  it('dry run plans and writes nothing', async () => {
    const { svc, booking } = setup();
    const res = await svc.runAuto(PROPERTY_ID, AUTO, { keepClosed: new Set(), dryRun: true });
    expect(res?.plan.changes).toHaveLength(7);
    expect(res?.job).toBeNull();
    expect(booking.setRates).not.toHaveBeenCalled();
  });

  it('opens closed nights only, leaves the «keep closed» ones, waits for the end', async () => {
    const nights = closedNights('2026-11-01', '2026-11-08');
    nights['2026-11-02'] = { closed: false, price: 400, booked: 0 };
    const { svc, booking } = setup({ nights });
    const res = await svc.runAuto(PROPERTY_ID, AUTO, { keepClosed: new Set(['2026-11-05']), dryRun: false });
    expect(res?.job?.state).toBe('done');
    expect(booking.state.get('2026-11-02')).toEqual({ closed: false, price: 400, booked: 0 });
    expect(booking.state.get('2026-11-05')?.closed).toBe(true);
    expect(booking.state.get('2026-11-01')).toEqual({ closed: false, price: 1180, booked: 0 });
    expect((await svc.job(USER, PROPERTY_ID))?.source).toBe('auto');
  });

  it('never goes into the past', async () => {
    const { svc, booking } = setup({ nights: closedNights('2026-10-10', '2026-10-14') });
    const res = await svc.runAuto(PROPERTY_ID, { ...AUTO, dateFrom: '2026-10-10', dateToExclusive: '2026-10-14' }, { keepClosed: new Set(), dryRun: false });
    expect(res?.plan.changes.map((c) => c.date)).toEqual(['2026-10-12', '2026-10-13']);
    expect(booking.state.get('2026-10-11')?.closed).toBe(true);
  });

  it('returns nothing to do for a range already in the past', async () => {
    const { svc } = setup();
    const res = await svc.runAuto(PROPERTY_ID, { ...AUTO, dateFrom: '2026-10-01', dateToExclusive: '2026-10-05' }, { keepClosed: new Set(), dryRun: false });
    expect(res).toEqual({ plan: expect.objectContaining({ changes: [] }), ranges: [], job: null });
  });

  it('skips when a manual run is going', async () => {
    const { svc, booking } = setup();
    let release!: () => void;
    booking.setRates.mockImplementationOnce(() => new Promise((r) => (release = () => r({}))));
    await svc.start(USER, OPEN);
    await new Promise((r) => setImmediate(r));
    expect(await svc.runAuto(PROPERTY_ID, AUTO, { keepClosed: new Set(), dryRun: false })).toBeNull();
    release();
    await finished(svc);
  });

  it('refuses an auto price below the minimum price', async () => {
    const { svc } = setup({ minPriceMinor: 200000 });
    await expect(svc.runAuto(PROPERTY_ID, AUTO, { keepClosed: new Set(), dryRun: true })).rejects.toThrow('ниже минимальной');
  });
});

describe('CalendarDatesService — re-pricing nights («базовая цена»)', () => {
  const open = (price: number, extra: Partial<Night> = {}): Night => ({ closed: false, price, booked: 0, ...extra });
  const prices = (m: Record<string, number>) => new Map(Object.entries(m));

  it('preview lists only open nights whose price changes; closed nights are left alone', async () => {
    const { svc, booking } = setup({
      nights: { '2026-11-01': open(500), '2026-11-02': open(500), '2026-11-03': { closed: true, price: 1180, booked: 0 } },
    });
    const p = await svc.previewPrices(USER, PROPERTY_ID, prices({ '2026-11-01': 500, '2026-11-02': 520, '2026-11-03': 520 }));
    expect(p.action).toBe('price');
    expect(p.dateFrom).toBe('2026-11-01');
    expect(p.dateToExclusive).toBe('2026-11-04');
    expect(p.changes).toEqual({ open: 0, close: 0, price: 1 });
    expect(p.skipped).toMatchObject({ unchanged: 1, closed: 1 });
    expect(p.ranges.map((r) => [r.dateFrom, r.dateToExclusive, r.price, r.closed])).toEqual([['2026-11-02', '2026-11-03', 520, false]]);
    expect(booking.setRates).not.toHaveBeenCalled();
  });

  it('never touches nights sold on Booking, covered in RentAI, or below the minimum price', async () => {
    const { svc } = setup({
      nights: { '2026-11-01': open(500, { booked: 1 }), '2026-11-02': open(500), '2026-11-03': open(500) },
      crmBlocked: ['2026-11-02'],
      minPriceMinor: 45000,
    });
    const p = await svc.previewPrices(USER, PROPERTY_ID, prices({ '2026-11-01': 600, '2026-11-02': 600, '2026-11-03': 400, '2026-11-04': 600 }));
    expect(p.changes.price).toBe(0);
    expect(p.skipped).toMatchObject({ booked: 1, crm: 1, belowMin: 1, missing: 1 });
  });

  it('past nights and nights beyond the horizon are left out; none left → 400', async () => {
    const { svc } = setup({ nights: { '2026-10-12': open(500), '2026-10-13': open(500) } });
    const p = await svc.previewPrices(USER, PROPERTY_ID, prices({ '2026-10-11': 600, '2026-10-12': 600, '2027-12-01': 600 }));
    expect(p.dateFrom).toBe('2026-10-12');
    expect(p.dateToExclusive).toBe('2026-10-13');
    await expect(svc.previewPrices(USER, PROPERTY_ID, prices({ '2026-10-01': 600 }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('send writes the new prices of open nights, never touches a closed one, and reads them back', async () => {
    const { svc, booking, sync } = setup({
      nights: { '2026-11-01': open(500), '2026-11-02': open(500), '2026-11-03': { closed: true, price: 1180, booked: 0 } },
    });
    const job = await svc.startPrices(USER, PROPERTY_ID, prices({ '2026-11-01': 520, '2026-11-02': 520, '2026-11-03': 520 }));
    expect(job.action).toBe('price');
    const done = await finished(svc);
    expect(done.state).toBe('done');
    expect(done.applied).toEqual({ open: 0, close: 0, price: 2 });
    expect(done.verify).toEqual({ checked: 2, mismatched: [] });
    expect(booking.state.get('2026-11-01')).toEqual(open(520));
    expect(booking.state.get('2026-11-03')).toEqual({ closed: true, price: 1180, booked: 0 });
    // one request for 01–02; the open / closed state is not sent at all
    expect(booking.setRates.mock.calls.map((c) => [c[0].dateFrom, c[0].dateToExclusive, c[0].closed])).toEqual([
      ['2026-11-01', '2026-11-03', undefined],
    ]);
    expect(sync.invalidateCalendarOverlay).toHaveBeenCalledWith(PROPERTY_ID);
  });

  it('a month that is all closed: nothing to send → 400, Booking untouched', async () => {
    const { svc, booking } = setup({ nights: closedNights('2026-11-01', '2026-11-08') });
    const p = await svc.previewPrices(USER, PROPERTY_ID, prices({ '2026-11-01': 300, '2026-11-02': 300 }));
    expect(p.changes.price).toBe(0);
    expect(p.skipped.closed).toBe(2);
    await expect(svc.startPrices(USER, PROPERTY_ID, prices({ '2026-11-01': 300 }))).rejects.toThrow('Отправлять нечего');
    expect(booking.setRates).not.toHaveBeenCalled();
  });

  it('a night closed meanwhile by someone else is no «mismatch»: only the price is checked back', async () => {
    const { svc, booking } = setup({ nights: { '2026-11-01': open(500) } });
    booking.setRates.mockImplementationOnce(async (p) => {
      booking.state.set('2026-11-01', { closed: true, price: Number(p.price), booked: 0 });
      return { status: { returnCode: 200 } };
    });
    await svc.startPrices(USER, PROPERTY_ID, prices({ '2026-11-01': 520 }));
    const done = await finished(svc);
    expect(done.verify).toEqual({ checked: 1, mismatched: [] });
  });

  it('the run plans from a fresh read of Booking, not the preview’s cache', async () => {
    const { svc, booking } = setup({ nights: { '2026-11-01': open(500) } });
    await svc.previewPrices(USER, PROPERTY_ID, prices({ '2026-11-01': 520 }));
    const reads = booking.getAvailability.mock.calls.length;
    booking.state.set('2026-11-01', open(500, { booked: 1 }));
    await expect(svc.startPrices(USER, PROPERTY_ID, prices({ '2026-11-01': 520 }))).rejects.toThrow('Отправлять нечего');
    expect(booking.getAvailability.mock.calls.length).toBeGreaterThan(reads);
  });

  it('readOpenRatePrices: open nights of the main rate from today on, closed ones left out', async () => {
    const { svc } = setup({
      nights: { '2026-10-11': open(300), '2026-10-12': open(310), '2026-10-13': { closed: true, price: 1180, booked: 0 }, '2026-10-14': open(320, { booked: 1 }) },
    });
    const m = await svc.readOpenRatePrices(USER, PROPERTY_ID, '2026-10-01', '2026-10-15');
    expect([...m]).toEqual([['2026-10-12', 310], ['2026-10-14', 320]]);
    expect([...(await svc.readOpenRatePrices(USER, PROPERTY_ID, '2026-09-01', '2026-10-01'))]).toEqual([]);
  });

  it('nothing to change → 400 instead of an empty run', async () => {
    const { svc, booking } = setup({ nights: { '2026-11-01': open(500) } });
    await expect(svc.startPrices(USER, PROPERTY_ID, prices({ '2026-11-01': 500 }))).rejects.toThrow('Отправлять нечего');
    expect(booking.setRates).not.toHaveBeenCalled();
  });

  it('one run per property at a time, prices or dates alike', async () => {
    const { svc, booking } = setup({ nights: { '2026-11-01': open(500), '2026-11-02': open(500) } });
    let release: () => void = () => undefined;
    booking.setRates.mockImplementationOnce(() => new Promise((r) => (release = () => r({ status: { returnCode: 200 } }))));
    await svc.startPrices(USER, PROPERTY_ID, prices({ '2026-11-01': 520 }));
    await expect(svc.startPrices(USER, PROPERTY_ID, prices({ '2026-11-02': 520 }))).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.start(USER, OPEN)).rejects.toBeInstanceOf(ConflictException);
    release();
    await finished(svc);
  });

  it('answers 503 while the dates tool is off', async () => {
    const { svc } = setup({ env: { ZODOMUS_CALENDAR_DATES_ENABLED: false } });
    await expect(svc.previewPrices(USER, PROPERTY_ID, prices({ '2026-11-01': 520 }))).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(svc.startPrices(USER, PROPERTY_ID, prices({ '2026-11-01': 520 }))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('CalendarDatesService — «Автоцены» run', () => {
  const open = (price: number, extra: Partial<Night> = {}): Night => ({ closed: false, price, booked: 0, ...extra });
  const prices = (m: Record<string, number>) => new Map(Object.entries(m));

  it('sends the changed prices of open nights and returns the finished run', async () => {
    const { svc, booking } = setup({ nights: { '2026-11-01': open(500), '2026-11-02': open(500) } });
    const res = await svc.runPricesAuto(PROPERTY_ID, prices({ '2026-11-01': 475, '2026-11-02': 500 }));
    expect(res!.ranges).toHaveLength(1);
    expect(res!.job).toMatchObject({ source: 'auto', action: 'price', state: 'done', failed: [] });
    expect(booking.state.get('2026-11-01')).toEqual(open(475));
    expect(booking.setRates).toHaveBeenCalledTimes(1);
  });

  it('Booking already has these prices: no run, nothing sent', async () => {
    const { svc, booking } = setup({ nights: { '2026-11-01': open(475) } });
    const res = await svc.runPricesAuto(PROPERTY_ID, prices({ '2026-11-01': 475 }));
    expect(res).toMatchObject({ ranges: [], job: null });
    expect(booking.setRates).not.toHaveBeenCalled();
  });

  it('sold nights and prices under the minimum are skipped, as in «Отправить в Booking»', async () => {
    const { svc, booking } = setup({ nights: { '2026-11-01': open(500, { booked: 1 }), '2026-11-02': open(500) }, minPriceMinor: 45000 });
    const res = await svc.runPricesAuto(PROPERTY_ID, prices({ '2026-11-01': 475, '2026-11-02': 400 }));
    expect(res!.job).toBeNull();
    expect(res!.plan.skipped).toMatchObject({ booked: 1, belowMin: 1 });
    expect(booking.setRates).not.toHaveBeenCalled();
  });

  it('only past nights: an empty plan, Booking not even read', async () => {
    const { svc, booking } = setup({ nights: {} });
    const res = await svc.runPricesAuto(PROPERTY_ID, prices({ '2026-10-01': 475 }));
    expect(res).toMatchObject({ ranges: [], job: null, plan: { changes: [] } });
    expect(booking.getAvailability).not.toHaveBeenCalled();
  });

  it('another run of the property is going: null, nothing sent', async () => {
    const { svc, booking } = setup({ nights: { '2026-11-01': open(500), '2026-11-02': open(500) } });
    let release: () => void = () => undefined;
    booking.setRates.mockImplementationOnce(() => new Promise((r) => (release = () => r({ status: { returnCode: 200 } }))));
    await svc.startPrices(USER, PROPERTY_ID, prices({ '2026-11-01': 520 }));
    await expect(svc.runPricesAuto(PROPERTY_ID, prices({ '2026-11-02': 475 }))).resolves.toBeNull();
    release();
    await finished(svc);
    expect(booking.setRates).toHaveBeenCalledTimes(1);
  });

  it('answers 503 while the dates tool is off', async () => {
    const { svc } = setup({ env: { ZODOMUS_CALENDAR_DATES_ENABLED: false } });
    await expect(svc.runPricesAuto(PROPERTY_ID, prices({ '2026-11-01': 475 }))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
