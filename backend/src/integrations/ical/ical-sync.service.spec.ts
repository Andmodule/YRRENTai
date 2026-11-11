import { BOOKING_STATUS } from '@rentai/shared';
import { ICalSyncService } from './ical-sync.service';

const PID = '0a240ac8-46a3-4a1b-aa09-359b1b560531';
const AIRBNB = 'https://ru.airbnb.com/calendar/ical/859458401639089947.ics?t=x';
const BOOKING = 'https://admin.booking.com/hotel/hoteladmin/ical.html?t=y';
const NA = 'Airbnb (Not available)';

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
/** UTC midnight n days from today — how a DATE value of a feed is parsed. */
const ahead = (n: number) => {
  const d = new Date(Date.now() + n * 86_400_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

type Ev = { uid: string; from: number; to: number; summary: string };
function feed(events: Ev[]): string {
  const body = events
    .map((e) => `BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${ymd(ahead(e.from))}\r\nDTEND;VALUE=DATE:${ymd(ahead(e.to))}\r\nSUMMARY:${e.summary}\r\nUID:${e.uid}\r\nEND:VEVENT`)
    .join('\r\n');
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Airbnb Inc//Hosting Calendar 1.0//EN\r\n${body}\r\nEND:VCALENDAR\r\n`;
}

const TAIL: Ev = { uid: 'tail@airbnb.com', from: 90, to: 366, summary: NA };

type Row = { id: string; propertyId: string; icalUid: string | null; status: string; checkIn: Date; checkOut: Date; notes?: string; guestName?: string };
const row = (id: string, uid: string | null, from: number, to: number, notes: string, propertyId = PID): Row => ({
  id,
  propertyId,
  icalUid: uid,
  status: BOOKING_STATUS.CONFIRMED,
  checkIn: ahead(from),
  checkOut: ahead(to),
  notes,
});

function setup(feeds: Record<string, string | { status: number } | Error>, rows: Row[] = [], urls = [AIRBNB]) {
  const db: Row[] = rows.map((r) => ({ ...r }));
  const bookingRepo = {
    findOne: jest.fn(async ({ where }: { where: { icalUid: string; propertyId: string } }) =>
      db.find((r) => r.icalUid === where.icalUid && r.propertyId === where.propertyId) ?? null,
    ),
    // Mirrors { propertyId, status, icalUid: Not(IsNull()) }: the operator is checked to be there.
    find: jest.fn(async ({ where }: { where: { propertyId: string; status: string; icalUid: unknown } }) => {
      expect(where.icalUid).toBeDefined();
      return db.filter((r) => r.propertyId === where.propertyId && r.status === where.status && r.icalUid != null);
    }),
    create: jest.fn((r: Partial<Row>) => ({ id: `new-${db.length}`, ...r }) as Row),
    save: jest.fn(async (r: Row) => {
      const i = db.findIndex((x) => x.id === r.id);
      if (i >= 0) db[i] = r;
      else db.push(r);
      return r;
    }),
    update: jest.fn(async ({ id }: { id: string }, patch: Partial<Row>) => {
      const r = db.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
    }),
  };
  const property = { id: PID, ownerId: 'owner-1', currency: 'PLN', icalImportUrls: urls };
  const propertyService = { findOneForUser: jest.fn(async () => property) };
  const push = { scheduleAvailabilityPush: jest.fn() };
  const svc = new ICalSyncService(propertyService as never, push as never, bookingRepo as never, {} as never);
  jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const f = feeds[String(input)];
    if (f instanceof Error) throw f;
    if (f == null) return { ok: false, status: 404, text: async () => '' } as Response;
    if (typeof f === 'object') return { ok: false, status: f.status, text: async () => '' } as Response;
    return { ok: true, status: 200, text: async () => f } as Response;
  });
  const status = () => Object.fromEntries(db.map((b) => [b.id, b.status]));
  return { svc, db, push, status, bookingRepo };
}

afterEach(() => jest.restoreAllMocks());

const sync = (s: ReturnType<typeof setup>) => s.svc.syncProperty('owner-1', 'OWNER', PID);

describe('ICalSyncService — Airbnb booking-window tail', () => {
  it('imports the reservations and a short host closure, skips the window tail', async () => {
    const s = setup({
      [AIRBNB]: feed([
        { uid: 'r1@airbnb.com', from: 17, to: 18, summary: 'Reserved' },
        { uid: 'r2@airbnb.com', from: 23, to: 25, summary: 'Reserved' },
        { uid: 'na-short@airbnb.com', from: 40, to: 42, summary: NA },
        TAIL,
      ]),
    });
    const [r] = await sync(s);
    expect(r).toMatchObject({ imported: 3, skipped: 1, cancelled: 0, failed: 0 });
    expect(s.db.map((b) => b.icalUid).sort()).toEqual(['na-short@airbnb.com', 'r1@airbnb.com', 'r2@airbnb.com']);
    expect(s.push.scheduleAvailabilityPush).toHaveBeenCalledWith(PID);
  });

  it('real long closures are imported: renovation from day 35, a host block next to the tail (day 60 → year end)', async () => {
    const s = setup({
      [AIRBNB]: feed([
        { uid: 'reno@airbnb.com', from: 35, to: 366, summary: NA },
        { uid: 'merged@airbnb.com', from: 60, to: 366, summary: NA },
        { uid: 'from-today@airbnb.com', from: 0, to: 366, summary: NA },
      ]),
    });
    const [r] = await sync(s);
    expect(r).toMatchObject({ imported: 3, skipped: 0, cancelled: 0 });
  });

  it('a host closure merged with the tail a few days before the window edge is imported and kept, sync after sync', async () => {
    const s = setup({ [AIRBNB]: feed([{ uid: 'merged@airbnb.com', from: 85, to: 366, summary: NA }]) });
    const [r1] = await sync(s);
    expect(r1).toMatchObject({ imported: 1, skipped: 0, cancelled: 0 });
    const [r2] = await sync(s);
    expect(r2).toMatchObject({ updated: 1, skipped: 0, cancelled: 0 });
    expect(s.status()).toEqual({ 'new-0': BOOKING_STATUS.CONFIRMED });
  });

  it('12-month window: a host block from day 180 to day 400 is imported, not taken for a tail', async () => {
    const s = setup({ [AIRBNB]: feed([{ uid: 'hb@airbnb.com', from: 180, to: 400, summary: NA }]) });
    const [r] = await sync(s);
    expect(r).toMatchObject({ imported: 1, skipped: 0 });
  });

  it('a uid cancelled as a tail that comes back as a real closure is confirmed again', async () => {
    const s = setup({ [AIRBNB]: feed([{ uid: 'tail@airbnb.com', from: 0, to: 366, summary: NA }]) }, [
      { ...row('b1', 'tail@airbnb.com', 88, 364, NA), status: BOOKING_STATUS.CANCELLED },
    ]);
    const [r] = await sync(s);
    expect(r).toMatchObject({ updated: 1, cancelled: 0 });
    expect(s.status()).toEqual({ b1: BOOKING_STATUS.CONFIRMED });
  });

  it('a tail imported earlier is cancelled: same uid (any dates), or a recent tail with another uid; the rest stays', async () => {
    const s = setup({ [AIRBNB]: feed([TAIL]) }, [
      row('b1', 'tail@airbnb.com', 85, 361, NA), // same uid, imported 5 days ago
      row('b2', 'tail-old@airbnb.com', 88, 364, NA), // yesterday's tail, another uid
      row('b3', 'r1@airbnb.com', 17, 18, 'Reserved'),
      row('b4', 'reno@airbnb.com', 35, 366, NA), // a real closure
      row('b5', 'na-now@airbnb.com', 0, 366, NA), // closed from today on
      row('b6', null, 90, 366, NA), // not from iCal
      row('b7', 'tail-x@airbnb.com', 90, 366, NA, 'other'), // another property
      row('b8', 'tail-ancient@airbnb.com', 60, 340, NA), // too old to tell from a closure: kept
    ]);
    const [r] = await sync(s);
    expect(r).toMatchObject({ imported: 0, updated: 0, skipped: 1, cancelled: 2 });
    expect(s.status()).toEqual({
      b1: BOOKING_STATUS.CANCELLED,
      b2: BOOKING_STATUS.CANCELLED,
      b3: BOOKING_STATUS.CONFIRMED,
      b4: BOOKING_STATUS.CONFIRMED,
      b5: BOOKING_STATUS.CONFIRMED,
      b6: BOOKING_STATUS.CONFIRMED,
      b7: BOOKING_STATUS.CONFIRMED,
      b8: BOOKING_STATUS.CONFIRMED,
    });
  });

  it('two feeds (Booking + Airbnb): Booking’s «CLOSED - Not available» imported, tail skipped, cleanup once', async () => {
    const s = setup(
      {
        [BOOKING]: feed([{ uid: 'bk1@booking.com', from: 90, to: 366, summary: 'CLOSED - Not available' }]),
        [AIRBNB]: feed([TAIL]),
      },
      [row('b1', 'tail@airbnb.com', 90, 366, NA)],
      [BOOKING, AIRBNB],
    );
    const res = await sync(s);
    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({ url: BOOKING, imported: 1, skipped: 0, cancelled: 1 });
    expect(res[1]).toMatchObject({ url: AIRBNB, imported: 0, skipped: 1, cancelled: 0 });
    expect(s.bookingRepo.find).toHaveBeenCalledTimes(1);
    expect(s.status().b1).toBe(BOOKING_STATUS.CANCELLED);
  });

  it('feed down: nothing imported and nothing cancelled by dates (what the feed holds is unknown)', async () => {
    for (const f of [{ status: 500 }, new Error('timeout')]) {
      const s = setup({ [AIRBNB]: f as never }, [row('b1', 'tail@airbnb.com', 90, 366, NA), row('b2', 'merged@airbnb.com', 85, 366, NA)]);
      const [r] = await sync(s);
      expect(r).toMatchObject({ imported: 0, cancelled: 0 });
      expect(r!.error).toBeDefined();
      expect(s.status()).toEqual({ b1: BOOKING_STATUS.CONFIRMED, b2: BOOKING_STATUS.CONFIRMED });
    }
  });

  it('two feeds, one down: the tail of the other is still cancelled by its uid, nothing by dates', async () => {
    const s = setup(
      { [BOOKING]: { status: 503 }, [AIRBNB]: feed([TAIL]) },
      [row('b1', 'tail@airbnb.com', 90, 366, NA), row('b2', 'tail-old@airbnb.com', 88, 364, NA)],
      [BOOKING, AIRBNB],
    );
    await sync(s);
    expect(s.status()).toEqual({ b1: BOOKING_STATUS.CANCELLED, b2: BOOKING_STATUS.CONFIRMED });
  });

  it('feed read but empty: a recent stored tail is cleaned up by dates', async () => {
    const s = setup({ [AIRBNB]: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' }, [
      row('b1', 'tail@airbnb.com', 90, 366, NA),
      row('b2', 'r1@airbnb.com', 17, 18, 'Reserved'),
    ]);
    const [r] = await sync(s);
    expect(r).toMatchObject({ imported: 0, cancelled: 1 });
    expect(s.status()).toEqual({ b1: BOOKING_STATUS.CANCELLED, b2: BOOKING_STATUS.CONFIRMED });
  });

  it('a tail uid already used by another property’s row: that row is not touched', async () => {
    const s = setup({ [AIRBNB]: feed([TAIL]) }, [row('x1', 'tail@airbnb.com', 10, 12, 'Reserved', 'other')]);
    await sync(s);
    expect(s.status()).toEqual({ x1: BOOKING_STATUS.CONFIRMED });
  });

  it('a reservation uid of another property creates this property’s own booking (lookup scoped by property)', async () => {
    const s = setup({ [AIRBNB]: feed([{ uid: 'r1@airbnb.com', from: 17, to: 18, summary: 'Reserved' }]) }, [
      row('x1', 'r1@airbnb.com', 40, 41, 'Reserved', 'other'),
    ]);
    const [r] = await sync(s);
    expect(r).toMatchObject({ imported: 1, updated: 0 });
    expect(s.db.find((b) => b.id === 'x1')!.checkIn).toEqual(ahead(40));
  });

  it('«Импорт одной ссылки» also skips the tail, cleans up and pushes availability', async () => {
    const s = setup({ [AIRBNB]: feed([TAIL]) }, [row('b1', 'tail@airbnb.com', 90, 366, NA)]);
    const r = await s.svc.importUrl('owner-1', 'OWNER', PID, AIRBNB);
    expect(r).toMatchObject({ skipped: 1, cancelled: 1 });
    expect(s.push.scheduleAvailabilityPush).toHaveBeenCalledWith(PID);
  });
});
