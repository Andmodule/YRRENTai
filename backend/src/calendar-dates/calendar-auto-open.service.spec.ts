import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { QueryFailedError, type Repository } from 'typeorm';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import type { PropertyEntity } from '../property/entities/property.entity';
import { CalendarAutoOpenService } from './calendar-auto-open.service';
import type { CalendarDatesService } from './calendar-dates.service';
import type { CalendarDatesAppliedListener } from './calendar-dates.service';
import type { CalendarAutoOpenSettingsEntity } from './entities/calendar-auto-open-settings.entity';
import { addDaysYmd, emptySkipped, type NightChange } from './calendar-dates.util';

const PID = '46889a43-e073-46d3-8457-f03525dbb1c9';
const USER: JwtPayload = { sub: 'u1', email: 'a@b.c', role: 'OWNER' };

function row(over: Partial<CalendarAutoOpenSettingsEntity> = {}): CalendarAutoOpenSettingsEntity {
  return {
    propertyId: PID,
    enabled: true,
    horizonDays: 90,
    priceMinor: 118000,
    weekendPriceMinor: null,
    openedUntil: '2027-01-09',
    keepClosed: [],
    lastRunAt: null,
    lastResult: null,
    updatedAt: new Date(),
    ...over,
  } as CalendarAutoOpenSettingsEntity;
}

const change = (date: string): NightChange => ({ date, price: 1180, closed: false, fromPrice: 1180, fromClosed: true });
const closed = (date: string): NightChange => ({ date, price: 400, closed: true, fromPrice: 400, fromClosed: false });

function setup(
  opts: {
    env?: Record<string, unknown>;
    rows?: CalendarAutoOpenSettingsEntity[];
    minPrice?: number | null;
    datesEnabled?: boolean;
    /** Exclusive end allowed by the availability horizon. */
    horizonEnd?: string;
  } = {},
) {
  const env: Record<string, unknown> = { ZODOMUS_CALENDAR_AUTO_OPEN_ENABLED: true, ZODOMUS_CALENDAR_AUTO_OPEN_DRY_RUN: false, ...opts.env };
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  let listener: CalendarDatesAppliedListener | null = null;
  const dates = {
    enabled: opts.datesEnabled ?? true,
    assertEnabled: jest.fn(),
    assertAccess: jest.fn().mockResolvedValue(undefined),
    minPriceOf: jest.fn().mockResolvedValue(opts.minPrice ?? null),
    horizonEnd: jest.fn().mockReturnValue(opts.horizonEnd ?? '2027-10-13'),
    setAppliedListener: jest.fn((fn: CalendarDatesAppliedListener) => {
      listener = fn;
    }),
    runAuto: jest.fn(async (_pid: string, input: { dateFrom: string }) => ({
      plan: { nights: 1, changes: [change(input.dateFrom)], skipped: { ...emptySkipped(), unchanged: 2 }, alreadyClosed: [] },
      ranges: [{ dateFrom: input.dateFrom, dateToExclusive: input.dateFrom, price: 1180, closed: false, nights: 1 }],
      job: { state: 'done', failed: [], verify: { checked: 1, mismatched: [] } },
    })),
  } as unknown as CalendarDatesService & { runAuto: jest.Mock };
  const rows = new Map((opts.rows ?? [row()]).map((r) => [r.propertyId, { ...r }]));
  const repo = {
    find: jest.fn(async () => [...rows.values()].filter((r) => r.enabled).map((r) => ({ propertyId: r.propertyId }))),
    findOne: jest.fn(async ({ where }: { where: { propertyId: string } }) => {
      const r = rows.get(where.propertyId);
      return r ? { ...r, keepClosed: [...(r.keepClosed ?? [])] } : null;
    }),
    update: jest.fn(async ({ propertyId }: { propertyId: string }, patch: Partial<CalendarAutoOpenSettingsEntity>) => {
      const r = rows.get(propertyId);
      if (r) Object.assign(r, patch);
      return {};
    }),
    insert: jest.fn(async (r: CalendarAutoOpenSettingsEntity) => {
      if (rows.has(r.propertyId)) throw new Error('duplicate key');
      rows.set(r.propertyId, Object.assign({ lastRunAt: null, lastResult: null, weekendPriceMinor: null }, r));
      return {};
    }),
  } as unknown as Repository<CalendarAutoOpenSettingsEntity> & { update: jest.Mock; insert: jest.Mock; find: jest.Mock; findOne: jest.Mock };
  const propertyRepo = {
    findOne: jest.fn().mockResolvedValue({ id: PID, timezone: 'Europe/Warsaw' }),
  } as unknown as Repository<PropertyEntity>;
  const svc = new CalendarAutoOpenService(config, dates, repo, propertyRepo);
  svc.onModuleInit();
  svc.onModuleDestroy(); // no real timer in tests
  return { svc, dates, rows, repo, listener: () => listener! };
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-10-12T10:00:00Z'), doNotFake: ['setImmediate', 'setTimeout', 'setInterval', 'nextTick', 'queueMicrotask'] });
});
afterEach(() => jest.useRealTimers());

describe('CalendarAutoOpenService — switches', () => {
  it('is off unless both flags are on; dry run by default', () => {
    expect(setup({ env: { ZODOMUS_CALENDAR_AUTO_OPEN_ENABLED: false } }).svc.enabled).toBe(false);
    expect(setup({ datesEnabled: false }).svc.enabled).toBe(false);
    const { svc } = setup({ env: { ZODOMUS_CALENDAR_AUTO_OPEN_DRY_RUN: undefined } });
    expect(svc.enabled).toBe(true);
    expect(svc.dryRun).toBe(true);
    expect(svc.hourUtc).toBe(4);
    expect(setup({ env: { ZODOMUS_CALENDAR_AUTO_OPEN_HOUR_UTC: 30 } }).svc.hourUtc).toBe(4);
  });

  it('answers 503 on settings while off', async () => {
    const { svc } = setup({ env: { ZODOMUS_CALENDAR_AUTO_OPEN_ENABLED: false } });
    await expect(svc.get(USER, PID)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('says the migration is missing instead of a bare 500', async () => {
    const { svc, repo } = setup();
    const err = new QueryFailedError('select', [], new Error('relation does not exist'));
    (err as unknown as { driverError: { code: string } }).driverError = { code: '42P01' };
    repo.findOne.mockRejectedValueOnce(err);
    await expect(svc.get(USER, PID)).rejects.toThrow('1778500000000');
  });
});

describe('CalendarAutoOpenService — daily run', () => {
  it('runs once a day at or after the hour', async () => {
    const { svc, dates } = setup();
    await svc.tick(new Date('2026-10-12T03:59:00Z'));
    expect(dates.runAuto).not.toHaveBeenCalled();
    await svc.tick(new Date('2026-10-12T04:00:00Z'));
    await svc.tick(new Date('2026-10-12T05:30:00Z'));
    expect(dates.runAuto).toHaveBeenCalledTimes(1);
    // Next day: the far edge moves by one night.
    jest.setSystemTime(new Date('2026-10-13T04:01:00Z'));
    await svc.tick(new Date('2026-10-13T04:01:00Z'));
    expect(dates.runAuto).toHaveBeenCalledTimes(2);
    expect(dates.runAuto.mock.calls[1]![1]).toMatchObject({ dateFrom: '2027-01-10', dateToExclusive: '2027-01-11' });
  });

  it('never lets a database error escape the timer', async () => {
    const { svc, repo } = setup();
    repo.find.mockRejectedValueOnce(new Error('Neon down'));
    await expect(svc.tick(new Date('2026-10-12T04:00:00Z'))).resolves.toBeUndefined();
    const b = setup();
    b.repo.update.mockRejectedValueOnce(new Error('Neon down'));
    await expect(b.svc.tick(new Date('2026-10-12T04:00:00Z'))).resolves.toBeUndefined();
  });

  it('opens from the edge to today + N days at the saved prices and moves the edge', async () => {
    const { svc, dates, rows } = setup({ rows: [row({ openedUntil: '2027-01-08', weekendPriceMinor: 125000 })] });
    await svc.runAll();
    expect(dates.runAuto).toHaveBeenCalledWith(
      PID,
      { action: 'open', dateFrom: '2027-01-08', dateToExclusive: '2027-01-10', price: 1180, weekendPrice: 1250, onlyClosed: true },
      { keepClosed: new Set(), dryRun: false },
    );
    const r = rows.get(PID)!;
    expect(r.openedUntil).toBe('2027-01-10');
    expect(r.lastResult).toMatchObject({ dryRun: false, opened: 1, skipped: 2, failed: 0, mismatched: 0 });
    expect(r.lastRunAt).toBeInstanceOf(Date);
  });

  it('never goes beyond the availability horizon', async () => {
    const { svc, dates, rows } = setup({ rows: [row({ openedUntil: '2027-01-01' })], horizonEnd: '2027-01-05' });
    await svc.runAll();
    expect(dates.runAuto.mock.calls[0]![1]).toMatchObject({ dateFrom: '2027-01-01', dateToExclusive: '2027-01-05' });
    expect(rows.get(PID)!.openedUntil).toBe('2027-01-05');
  });

  it('writes back only its own fields, reading the settings fresh', async () => {
    const { svc, repo, rows } = setup({ rows: [row({ openedUntil: '2027-01-08' })] });
    repo.update.mockClear();
    await svc.runAll();
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(Object.keys(repo.update.mock.calls[0]![1]).sort()).toEqual(['lastResult', 'lastRunAt', 'openedUntil']);
    expect(rows.get(PID)!.priceMinor).toBe(118000);
  });

  it('skips a property switched off after the run started', async () => {
    const { svc, dates, repo } = setup({ rows: [row({ openedUntil: '2027-01-08' })] });
    repo.findOne.mockResolvedValueOnce({ ...row(), enabled: false });
    await svc.runAll();
    expect(dates.runAuto).not.toHaveBeenCalled();
  });

  it('uses the price saved meanwhile, not the one read at the start', async () => {
    const { svc, dates, repo } = setup({ rows: [row({ openedUntil: '2027-01-08' })] });
    repo.findOne.mockResolvedValueOnce({ ...row({ openedUntil: '2027-01-08' }), priceMinor: 99000 });
    await svc.runAll();
    expect(dates.runAuto.mock.calls[0]![1]).toMatchObject({ price: 990 });
  });

  it('does nothing when the edge is already far enough', async () => {
    const { svc, dates, rows } = setup({ rows: [row({ openedUntil: '2027-01-10' })] });
    await svc.runAll();
    expect(dates.runAuto).not.toHaveBeenCalled();
    expect(rows.get(PID)!.lastResult).toMatchObject({ opened: 0 });
  });

  it('starts from today when the edge is in the past (switched off for a while)', async () => {
    const { svc, dates } = setup({ rows: [row({ openedUntil: '2026-09-01' })] });
    await svc.runAll();
    expect(dates.runAuto.mock.calls[0]![1]).toMatchObject({ dateFrom: '2026-10-12' });
  });

  it('dry run reports and keeps the edge', async () => {
    const { svc, rows } = setup({ env: { ZODOMUS_CALENDAR_AUTO_OPEN_DRY_RUN: true }, rows: [row({ openedUntil: '2027-01-08' })] });
    await svc.runAll();
    expect(rows.get(PID)!.openedUntil).toBe('2027-01-08');
    expect(rows.get(PID)!.lastResult).toMatchObject({ dryRun: true, opened: 1 });
  });

  it('keeps the edge after a failed request so the next run retries', async () => {
    const { svc, dates, rows } = setup({ rows: [row({ openedUntil: '2027-01-08' })] });
    dates.runAuto.mockResolvedValueOnce({
      plan: { nights: 2, changes: [change('2027-01-08'), change('2027-01-09')], skipped: emptySkipped(), alreadyClosed: [] },
      ranges: [],
      job: { state: 'done', failed: [{ dateFrom: '2027-01-09', dateToExclusive: '2027-01-10', detail: 'x' }], verify: { checked: 1, mismatched: [] } },
    });
    await svc.runAll();
    expect(rows.get(PID)!.openedUntil).toBe('2027-01-08');
    expect(rows.get(PID)!.lastResult).toMatchObject({ opened: 1, failed: 1 });
  });

  it('moves the edge when there was nothing to open', async () => {
    const { svc, dates, rows } = setup({ rows: [row({ openedUntil: '2027-01-08' })] });
    dates.runAuto.mockResolvedValueOnce({ plan: { nights: 2, changes: [], skipped: emptySkipped(), alreadyClosed: [] }, ranges: [], job: null });
    await svc.runAll();
    expect(rows.get(PID)!.openedUntil).toBe('2027-01-10');
  });

  it('records a busy property and an error without stopping the others', async () => {
    const other = '11111111-1111-1111-1111-111111111111';
    const { svc, dates, rows } = setup({ rows: [row({ openedUntil: '2027-01-08' }), row({ propertyId: other, openedUntil: '2027-01-08' })] });
    dates.runAuto.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Zodomus down'));
    await svc.runAll();
    expect(rows.get(PID)!.lastResult).toMatchObject({ error: 'BUSY' });
    expect(rows.get(other)!.lastResult).toMatchObject({ error: 'Zodomus down' });
    expect(rows.get(other)!.openedUntil).toBe('2027-01-08');
  });

  it('passes the «keep closed» nights that are not past', async () => {
    const { svc, dates } = setup({ rows: [row({ openedUntil: '2027-01-08', keepClosed: ['2026-10-01', '2027-01-09'] })] });
    await svc.runAll();
    expect(dates.runAuto.mock.calls[0]![2]).toEqual({ keepClosed: new Set(['2027-01-09']), dryRun: false });
  });

  it('skips disabled rows and rows without a price', async () => {
    const { svc, dates } = setup({ rows: [row({ enabled: false, openedUntil: '2027-01-01' })] });
    await svc.runAll();
    expect(dates.runAuto).not.toHaveBeenCalled();
    const b = setup({ rows: [row({ priceMinor: null, openedUntil: '2027-01-01' })] });
    await b.svc.runAll();
    expect(b.dates.runAuto).not.toHaveBeenCalled();
  });
});

describe('CalendarAutoOpenService — closed by hand', () => {
  it('remembers nights closed by hand at or beyond the edge, not before it', async () => {
    const { listener, rows } = setup({ rows: [row({ openedUntil: '2027-01-10' })] });
    await listener()(PID, 'close', [closed('2027-01-09'), closed('2027-01-10'), closed('2027-02-01')], []);
    expect(rows.get(PID)!.keepClosed).toEqual(['2027-01-10', '2027-02-01']);
  });

  it('remembers nights that were closed already («Закрыть» on a closed far date)', async () => {
    const { listener, rows } = setup({ rows: [row({ openedUntil: '2027-01-10' })] });
    await listener()(PID, 'close', [], ['2027-12-31', '2027-01-01']);
    expect(rows.get(PID)!.keepClosed).toEqual(['2027-12-31']);
  });

  it('forgets them when they are opened by hand', async () => {
    const { listener, rows } = setup({ rows: [row({ keepClosed: ['2027-02-01', '2027-02-02'] })] });
    await listener()(PID, 'open', [change('2027-02-01')], []);
    expect(rows.get(PID)!.keepClosed).toEqual(['2027-02-02']);
  });

  it('records even before auto-extension is switched on, creating a switched-off row', async () => {
    const { listener, rows } = setup({ rows: [], env: { ZODOMUS_CALENDAR_AUTO_OPEN_ENABLED: false } });
    await listener()(PID, 'close', [closed('2027-02-01')], ['2027-02-02']);
    expect(rows.get(PID)).toMatchObject({ enabled: false, priceMinor: null, keepClosed: ['2027-02-01', '2027-02-02'] });
  });

  it('does not create a row for nothing to remember', async () => {
    const { listener, repo } = setup({ rows: [] });
    await listener()(PID, 'open', [change('2027-02-01')], []);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('falls back to an update when the row was created meanwhile', async () => {
    const { listener, repo, rows } = setup({ rows: [] });
    repo.findOne.mockResolvedValueOnce(null);
    rows.set(PID, row({ keepClosed: ['2027-03-01'] }));
    await listener()(PID, 'close', [closed('2027-02-01')], []);
    expect(rows.get(PID)!.keepClosed).toEqual(['2027-02-01', '2027-03-01']);
  });

  it('does nothing while the dates tool is off, and survives a missing table', async () => {
    const off = setup({ datesEnabled: false });
    await off.listener()(PID, 'close', [closed('2027-02-01')], []);
    expect(off.repo.findOne).not.toHaveBeenCalled();
    const missing = setup();
    missing.repo.findOne.mockRejectedValueOnce(new Error('relation "calendar_auto_open_settings" does not exist'));
    await expect(missing.listener()(PID, 'close', [closed('2027-02-01')], [])).resolves.toBeUndefined();
  });
});

describe('CalendarAutoOpenService — settings', () => {
  it('switching on starts at today + N days', async () => {
    const { svc, rows } = setup({ rows: [] });
    const v = await svc.save(USER, { propertyId: PID, enabled: true, horizonDays: 90, price: 1180, weekendPrice: 1250 });
    expect(rows.get(PID)).toMatchObject({ enabled: true, horizonDays: 90, priceMinor: 118000, weekendPriceMinor: 125000, openedUntil: '2027-01-10' });
    expect(v.settings).toMatchObject({ enabled: true, price: 1180, weekendPrice: 1250, openedUntil: '2027-01-10', keepClosed: 0 });
  });

  it('switching on never puts the edge beyond the availability horizon', async () => {
    const { svc, rows } = setup({ rows: [], horizonEnd: '2026-12-01' });
    await svc.save(USER, { propertyId: PID, enabled: true, horizonDays: 90, price: 1180 });
    expect(rows.get(PID)!.openedUntil).toBe('2026-12-01');
  });

  it('keeps the «closed by hand» list of a row created by a manual close', async () => {
    const { svc, rows } = setup({ rows: [row({ enabled: false, priceMinor: null, openedUntil: null, keepClosed: ['2027-05-01'] })] });
    await svc.save(USER, { propertyId: PID, enabled: true, horizonDays: 90, price: 1180 });
    expect(rows.get(PID)).toMatchObject({ enabled: true, keepClosed: ['2027-05-01'], openedUntil: '2027-01-10' });
  });

  it('saving again while on keeps the edge; switching back on later restarts it', async () => {
    const { svc, rows } = setup({ rows: [row({ openedUntil: '2027-01-02' })] });
    await svc.save(USER, { propertyId: PID, enabled: true, horizonDays: 120, price: 1000 });
    expect(rows.get(PID)!.openedUntil).toBe('2027-01-02');
    expect(rows.get(PID)!.weekendPriceMinor).toBeNull();
    await svc.save(USER, { propertyId: PID, enabled: false, horizonDays: 120, price: 1000 });
    expect(rows.get(PID)!.enabled).toBe(false);
    await svc.save(USER, { propertyId: PID, enabled: true, horizonDays: 30, price: 1000 });
    expect(rows.get(PID)!.openedUntil).toBe(addDaysYmd('2026-10-12', 30));
  });

  it('refuses a price below the minimum price when switching on, but always lets it be switched off', async () => {
    const { svc } = setup({ minPrice: 160 });
    await expect(svc.save(USER, { propertyId: PID, enabled: true, horizonDays: 90, price: 150 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.save(USER, { propertyId: PID, enabled: true, horizonDays: 90, price: 200, weekendPrice: 100 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.save(USER, { propertyId: PID, enabled: false, horizonDays: 90, price: 150 })).resolves.toBeDefined();
  });

  it('shows no settings for a property that has none, and no price for a «closed by hand» row', async () => {
    expect((await setup({ rows: [] }).svc.get(USER, PID)).settings).toBeNull();
    const v = await setup({ rows: [row({ enabled: false, priceMinor: null })] }).svc.get(USER, PID);
    expect(v.settings?.price).toBeNull();
  });
});
