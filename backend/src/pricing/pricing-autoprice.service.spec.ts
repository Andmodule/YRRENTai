import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import type { DataSource, Repository } from 'typeorm';
import { PricingConfig } from './pricing-config';
import { PricingAutoPriceService } from './pricing-autoprice.service';
import { autoPriceSettingsSchema } from './dto/pricing-autoprice.dto';
import { autoChannelPrice, DEFAULT_AUTO_PRICE_SETTINGS, type AutoPriceSettings } from './autoprice.util';
import { addDaysYmd } from './pricing-math.util';
import type { PricingService } from './pricing.service';
import type { PricingBasePriceService } from './pricing-base-price.service';
import type { CalendarDatesService } from '../calendar-dates/calendar-dates.service';
import type { PropertyService } from '../property/property.service';
import type { BookingEntity } from '../booking/entities/booking.entity';
import type {
  PricingAutoPriceRunEntity,
  PricingAutoPriceSettingsEntity,
  PropertyAutoPriceEntity,
} from './entities/pricing-auto-price.entity';
import type { JwtPayload } from '../common/decorators/current-user.decorator';

const OWNER: JwtPayload = { sub: 'u1', email: 'anna@example.com', role: 'OWNER' };
const OWNER_ID = 'o1';
const PILOT = { id: 'p-andersa', name: 'Andersa', timezone: 'Europe/Warsaw' };
const OTHER = { id: 'p-other', name: 'Другой', timezone: 'Europe/Warsaw' };
const OFF_BOOKING = { id: 'p-off', name: 'Без Booking', timezone: 'Europe/Warsaw' };
/** 2026-11-25 in Warsaw: «остаток месяца» of 7 nights has started (25…30 = 6 nights). */
const NOW = new Date('2026-11-25T10:00:00.000Z');
const TODAY = '2026-11-25';
const LAST = '2026-11-30';

type Stay = { checkIn: string; checkOut: string; status?: string };
type SettingsRow = {
  enabled: boolean;
  window?: AutoPriceSettings['window'];
  down?: AutoPriceSettings['down'];
  up?: AutoPriceSettings['up'];
};

/** A stay as the database keeps it: an instant near noon of the property day. */
const at = (ymd: string) => new Date(`${ymd}T12:00:00.000Z`);

function setup(
  opts: {
    env?: Record<string, unknown>;
    settings?: SettingsRow | null;
    stays?: Stay[];
    /** Adjustments already stored: night → percent. */
    stored?: Record<string, number>;
    /** Nights with a Booking price typed by hand. */
    typed?: string[];
    /** Base price of every night; null = none. */
    base?: number | null;
    min?: number | null;
    markup?: number;
    busy?: boolean;
    sendThrows?: Error;
    jobState?: 'done' | 'failed';
  } = {},
) {
  const values: Record<string, unknown> = {
    ZODOMUS_ENABLED: true,
    ZODOMUS_PROMOTIONS_ENABLED: true,
    ZODOMUS_PROMOTIONS_GUEST_PRICE_ENABLED: true,
    ZODOMUS_PROMOTIONS_BASE_PRICE_ENABLED: true,
    ZODOMUS_PROMOTIONS_AUTOPRICE_ENABLED: true,
    ZODOMUS_PROMOTIONS_DRY_RUN: false,
    ZODOMUS_PROMOTIONS_PROPERTY_ALLOWLIST: PILOT.id,
    ...opts.env,
  };
  const cfg = new PricingConfig({ get: (k: string) => values[k] } as unknown as ConfigService);
  const pricing = {
    assertEnabled: jest.fn(() => {
      if (!cfg.flags.enabled) throw new ServiceUnavailableException('off');
    }),
    actor: jest.fn(async () => ({ ownerId: OWNER_ID, userId: OWNER.sub, label: 'Anna · владелец' })),
  };
  const stored = new Map(Object.entries(opts.stored ?? {}));
  const base = opts.base === undefined ? 500 : opts.base;
  const basePrice = {
    bookingSendBlock: jest.fn((p: { id: string }) => {
      if (p.id === OFF_BOOKING.id) return 'NOT_ON_BOOKING';
      if (cfg.flags.allowlist.size === 0 || !cfg.isInAllowlist(p.id)) return 'NOT_IN_PILOT';
      return cfg.flags.dryRun ? 'DRY_RUN' : null;
    }),
    nightsSource: jest.fn(async (_id: string, from: string, to: string) => {
      const m = new Map<string, number>();
      if (base != null) for (let d = from; d <= to; d = addDaysYmd(d, 1)) m.set(d, base);
      return { base: m, typed: new Set(opts.typed ?? []) };
    }),
    bookingMarkup: jest.fn(async () => opts.markup ?? 0),
    // What «Отправить в Booking» sends, with the stored adjustments applied as the real service does.
    bookingTargets: jest.fn(async (_id: string, from: string, to: string, auto?: ReadonlyMap<string, number>) => {
      const t = new Map<string, number>();
      if (base == null) return t;
      const adj = auto ?? stored;
      for (let d = from; d <= to; d = addDaysYmd(d, 1)) {
        t.set(d, autoChannelPrice(base, adj.get(d) ?? 0, opts.markup ?? 0, adj.has(d) ? (opts.min ?? null) : null));
      }
      return t;
    }),
  };
  const dates = {
    minPriceOf: jest.fn(async () => opts.min ?? null),
    runPricesAuto: jest.fn(async (_id: string, targets: Map<string, number>) => {
      if (opts.sendThrows) throw opts.sendThrows;
      if (opts.busy) return null;
      const changes = [...targets].map(([date, price]) => ({ date, price }));
      return {
        plan: { nights: changes.length, changes, skipped: {}, alreadyClosed: [] },
        ranges: changes.length ? [{ from: changes[0]!.date }] : [],
        job: changes.length
          ? {
              state: opts.jobState ?? 'done',
              failed:
                opts.jobState === 'failed'
                  ? [{ dateFrom: changes[0]!.date, dateToExclusive: addDaysYmd(changes[0]!.date, 1), detail: 'x' }]
                  : [],
              verify: { checked: changes.length, mismatched: [] },
            }
          : null,
      };
    }),
  };
  const propertyService = { findAllByOwner: jest.fn(async () => [PILOT, OTHER, OFF_BOOKING]) };
  const removeDates = async ({ date }: { date: { _value: string[] } }) => {
    date._value.forEach((d) => stored.delete(d));
  };
  const tx = {
    delete: jest.fn(removeDates),
    upsert: jest.fn(async (rows: Array<{ date: string; pct: number }>) => {
      rows.forEach((r) => stored.set(r.date, r.pct));
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (work: (m: { getRepository: () => typeof tx }) => Promise<void>) => work({ getRepository: () => tx })),
  };
  const w = opts.settings?.window ?? DEFAULT_AUTO_PRICE_SETTINGS.window;
  let settingsRow: Partial<PricingAutoPriceSettingsEntity> | null =
    opts.settings == null
      ? null
      : {
          ownerId: OWNER_ID,
          enabled: opts.settings.enabled,
          windowKind: w.kind,
          windowDays: w.kind === 'next' ? w.days : w.daysBefore,
          down: opts.settings.down ?? DEFAULT_AUTO_PRICE_SETTINGS.down,
          up: opts.settings.up ?? DEFAULT_AUTO_PRICE_SETTINGS.up,
        };
  const settingsRepo = {
    findOne: jest.fn(async () => settingsRow),
    find: jest.fn(async () => (settingsRow ? [settingsRow] : [])),
    upsert: jest.fn(async (r: Partial<PricingAutoPriceSettingsEntity>) => {
      settingsRow = { ...r };
    }),
  };
  const autoRepo = {
    // Stored adjustments belong to the pilot property.
    find: jest.fn(async ({ where }: { where: { propertyId: string; date: { _value: string } } }) =>
      where.propertyId !== PILOT.id
        ? []
        : [...stored].filter(([d]) => d >= where.date._value).map(([date, pct]) => ({ propertyId: PILOT.id, date, pct })),
    ),
    delete: jest.fn(removeDates),
  };
  const runs: Array<Partial<PricingAutoPriceRunEntity>> = [];
  const runRepo = {
    insert: jest.fn(async (r: Partial<PricingAutoPriceRunEntity>) => {
      runs.push(r);
    }),
    find: jest.fn(async () => runs.map((r, i) => ({ id: `r${i}`, runAt: NOW, ...r }))),
    delete: jest.fn(async () => undefined),
  };
  const stays = (opts.stays ?? []).filter((s) => !['CANCELLED', 'DECLINED', 'NO_SHOW'].includes(s.status ?? 'CONFIRMED'));
  const qb = {
    select: () => qb,
    where: () => qb,
    andWhere: () => qb,
    getMany: jest.fn(async () => stays.map((s, i) => ({ id: `b${i}`, checkIn: at(s.checkIn), checkOut: at(s.checkOut) }))),
  };
  const bookingRepo = { createQueryBuilder: jest.fn(() => qb) };
  const svc = new PricingAutoPriceService(
    cfg,
    pricing as unknown as PricingService,
    basePrice as unknown as PricingBasePriceService,
    dates as unknown as CalendarDatesService,
    propertyService as unknown as PropertyService,
    dataSource as unknown as DataSource,
    settingsRepo as unknown as Repository<PricingAutoPriceSettingsEntity>,
    autoRepo as unknown as Repository<PropertyAutoPriceEntity>,
    runRepo as unknown as Repository<PricingAutoPriceRunEntity>,
    bookingRepo as unknown as Repository<BookingEntity>,
  );
  return { svc, stored, runs, dataSource, dates, basePrice, settingsRepo, runRepo };
}

type S = ReturnType<typeof setup>;
/** Lets the background run after a save finish. */
const idle = async (_s: S) => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
const pilotRow = async (s: S) => (await s.svc.overview(OWNER)).properties.find((p) => p.propertyId === PILOT.id)!;
const sentOf = (s: S) => [...(s.dates.runPricesAuto.mock.calls[0]![1] as Map<string, number>)];
const LIVE = { ZODOMUS_PROMOTIONS_AUTOPRICE_DRY_RUN: false };
const ON: SettingsRow = { enabled: true };
/** 2 of 6 nights booked (28, 29): 67 % unsold → the 50 % tier, −5 %. */
const TWO_OF_SIX: Stay[] = [{ checkIn: '2026-11-28', checkOut: LAST }];

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('PricingAutoPriceService — switches', () => {
  it.each([
    ['the autoprice flag', { ZODOMUS_PROMOTIONS_AUTOPRICE_ENABLED: false }],
    ['«Базовая цена»', { ZODOMUS_PROMOTIONS_BASE_PRICE_ENABLED: false }],
    ['promotions', { ZODOMUS_PROMOTIONS_ENABLED: false }],
  ])('%s off: 503 on the page and the save, the daily run does nothing', async (_n, env) => {
    const s = setup({ env, settings: ON });
    await expect(s.svc.overview(OWNER)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(s.svc.saveSettings(OWNER, { ...DEFAULT_AUTO_PRICE_SETTINGS, enabled: true })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await s.svc.tick(new Date('2026-11-25T06:00:00Z'));
    expect(s.settingsRepo.find).not.toHaveBeenCalled();
    expect(s.dates.runPricesAuto).not.toHaveBeenCalled();
  });

  it('«Только показывать» by default; the promotions test mode also counts as «Только показывать»', () => {
    expect(setup().svc.dryRun).toBe(true);
    expect(setup({ env: LIVE }).svc.dryRun).toBe(false);
    expect(setup({ env: { ...LIVE, ZODOMUS_PROMOTIONS_DRY_RUN: true } }).svc.dryRun).toBe(true);
  });

  it('flag on before the migration: a clear 503 naming the migration', async () => {
    const s = setup();
    s.settingsRepo.findOne.mockRejectedValueOnce(
      new QueryFailedError('select', [], Object.assign(new Error('relation does not exist'), { code: '42P01' })),
    );
    await expect(s.svc.overview(OWNER)).rejects.toThrow('1778800000000');
  });
});

describe('PricingAutoPriceService — settings', () => {
  it('no saved rule: the defaults, switched off', async () => {
    const o = await setup().svc.overview(OWNER);
    expect(o.settings).toEqual({ ...DEFAULT_AUTO_PRICE_SETTINGS, enabled: false, isDefault: true });
    expect(o.dryRun).toBe(true);
    expect(o.runHour).toBe(6);
    expect(o.timeZone).toBe('Europe/Warsaw');
  });

  it('save: tiers stored sorted, the window kept, read back as saved', async () => {
    const s = setup();
    const o = await s.svc.saveSettings(OWNER, {
      enabled: true,
      window: { kind: 'next', days: 10 },
      down: [
        { unsoldPct: 50, pct: 5 },
        { unsoldPct: 70, pct: 10 },
      ],
      up: [
        { soldPct: 85, pct: 5 },
        { soldPct: 95, pct: 10 },
      ],
    });
    expect(s.settingsRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: OWNER_ID, windowKind: 'next', windowDays: 10 }),
      ['ownerId'],
    );
    expect(o.settings).toMatchObject({
      enabled: true,
      isDefault: false,
      window: { kind: 'next', days: 10 },
      down: [
        { unsoldPct: 70, pct: 10 },
        { unsoldPct: 50, pct: 5 },
      ],
      up: [
        { soldPct: 95, pct: 10 },
        { soldPct: 85, pct: 5 },
      ],
    });
  });

  it('live: saving acts at once — switched off, the adjustments go and the base price is sent back', async () => {
    const s = setup({ env: LIVE, settings: ON, stored: { '2026-11-25': -10, '2026-11-26': -10 } });
    await s.svc.saveSettings(OWNER, { ...DEFAULT_AUTO_PRICE_SETTINGS, enabled: false });
    // the run goes in the background: the save does not wait for Booking
    await idle(s);
    expect(s.stored.size).toBe(0);
    expect(sentOf(s)).toEqual([
      ['2026-11-25', 500],
      ['2026-11-26', 500],
    ]);
  });

  it('live: the save answers before Booking does', async () => {
    const s = setup({ env: LIVE, settings: ON });
    let release: () => void = () => undefined;
    s.dates.runPricesAuto.mockImplementationOnce(() => new Promise((r) => (release = () => r(null))));
    await s.svc.saveSettings(OWNER, { ...DEFAULT_AUTO_PRICE_SETTINGS, enabled: false });
    expect(s.runs).toEqual([]);
    release();
    await idle(s);
  });

  it('live: saving the same rule again runs nothing', async () => {
    const s = setup({ env: LIVE, settings: ON });
    await s.svc.saveSettings(OWNER, { ...DEFAULT_AUTO_PRICE_SETTINGS, enabled: true });
    await idle(s);
    expect(s.runs).toEqual([]);
  });

  it('live: a save during the daily run is run again right after it', async () => {
    const s = setup({ env: LIVE, settings: ON, stays: TWO_OF_SIX, stored: { '2026-11-25': -10 } });
    let release: () => void = () => undefined;
    s.dates.runPricesAuto.mockImplementationOnce(() => new Promise((r) => (release = () => r(null))));
    const daily = s.svc.runAll();
    await new Promise((r) => setImmediate(r));
    await s.svc.saveSettings(OWNER, { ...DEFAULT_AUTO_PRICE_SETTINGS, enabled: false });
    release();
    await daily;
    // the daily run (busy, nothing stored), then the queued run of the switched-off rule takes the night off
    expect(s.runs.map((r) => r.windowFrom)).toEqual([TODAY, null]);
    expect(s.stored.size).toBe(0);
  });

  it('«Только показывать»: saving runs nothing', async () => {
    const s = setup({ settings: ON });
    await s.svc.saveSettings(OWNER, { ...DEFAULT_AUTO_PRICE_SETTINGS, enabled: false });
    expect(s.dates.runPricesAuto).not.toHaveBeenCalled();
    expect(s.runs).toEqual([]);
  });

  it('a rule that contradicts itself: 400, nothing saved', async () => {
    const s = setup();
    // 50 % unsold → down and 50 % sold → up at the same time
    await expect(
      s.svc.saveSettings(OWNER, {
        enabled: true,
        window: { kind: 'next', days: 10 },
        down: [{ unsoldPct: 50, pct: 5 }],
        up: [{ soldPct: 50, pct: 5 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(s.settingsRepo.upsert).not.toHaveBeenCalled();
  });
});

describe('PricingAutoPriceService — what the rule does today', () => {
  it('pilot property first; the others are listed with the reason and not read', async () => {
    const s = setup({ settings: ON, stays: TWO_OF_SIX });
    const o = await s.svc.overview(OWNER);
    expect(o.properties.map((p) => [p.propertyId, p.block])).toEqual([
      [PILOT.id, null],
      [OTHER.id, 'NOT_IN_PILOT'],
      [OFF_BOOKING.id, 'NOT_ON_BOOKING'],
    ]);
    expect(s.basePrice.nightsSource).toHaveBeenCalledTimes(1);
  });

  it('an empty pilot list means nobody', async () => {
    const o = await setup({ settings: ON, env: { ZODOMUS_PROMOTIONS_PROPERTY_ALLOWLIST: '' } }).svc.overview(OWNER);
    expect(o.properties.every((p) => p.block != null)).toBe(true);
  });

  it('«остаток месяца» of 7: 2 of 6 nights booked → −5 % on the 4 free nights, booked nights untouched', async () => {
    const row = await pilotRow(setup({ settings: ON, stays: TWO_OF_SIX }));
    expect(row).toMatchObject({ window: { from: TODAY, to: LAST }, totalNights: 6, bookedNights: 2, soldPct: 33, pct: -5 });
    expect(row.nights.map((n) => [n.date, n.status, n.after])).toEqual([
      ['2026-11-25', 'adjusted', 475],
      ['2026-11-26', 'adjusted', 475],
      ['2026-11-27', 'adjusted', 475],
      ['2026-11-28', 'booked', 500],
      ['2026-11-29', 'booked', 500],
      ['2026-11-30', 'adjusted', 475],
    ]);
  });

  it('nothing booked → the emptiest tier, −10 %; the Booking markup on top', async () => {
    const row = await pilotRow(setup({ settings: ON, markup: 10 }));
    expect(row.pct).toBe(-10);
    // 500 −10 % = 450, +10 % markup = 495
    expect(row.nights[0]).toMatchObject({ status: 'adjusted', before: 550, after: 495 });
  });

  it('cancelled bookings do not count as sold', async () => {
    const row = await pilotRow(setup({ settings: ON, stays: [{ checkIn: TODAY, checkOut: LAST, status: 'CANCELLED' }] }));
    expect(row.bookedNights).toBe(0);
  });

  it('a stay that began before the window counts only its nights inside', async () => {
    const row = await pilotRow(setup({ settings: ON, stays: [{ checkIn: '2026-11-20', checkOut: '2026-11-27' }] }));
    expect(row.bookedNights).toBe(2);
  });

  it('much sold → up: «next 10 nights», 9 booked = 90 % → +5 % on the free night', async () => {
    const row = await pilotRow(
      setup({ settings: { enabled: true, window: { kind: 'next', days: 10 } }, stays: [{ checkIn: TODAY, checkOut: '2026-12-04' }] }),
    );
    expect(row).toMatchObject({ totalNights: 10, bookedNights: 9, pct: 5 });
    expect(row.nights.filter((n) => n.status === 'adjusted')).toEqual([
      { date: '2026-12-04', status: 'adjusted', pct: 5, before: 500, after: 525 },
    ]);
  });

  it('between the tiers (60 % sold) → 0, nothing changes', async () => {
    const row = await pilotRow(
      setup({ settings: { enabled: true, window: { kind: 'next', days: 10 } }, stays: [{ checkIn: TODAY, checkOut: '2026-12-01' }] }),
    );
    expect(row.pct).toBe(0);
    expect(row.nights.some((n) => n.status === 'adjusted' || n.status === 'minimum')).toBe(false);
  });

  it('«остаток месяца» has not started yet → silent, no window', async () => {
    jest.setSystemTime(new Date('2026-11-20T10:00:00Z'));
    const row = await pilotRow(setup({ settings: ON }));
    expect(row.window).toBeNull();
    expect(row.nights).toEqual([]);
  });

  it('a price typed by hand and a night without a base price are left alone', async () => {
    const row = await pilotRow(setup({ settings: ON, typed: ['2026-11-25'], base: null }));
    expect(row.nights.map((n) => n.status)).toEqual(['typed', 'no_base', 'no_base', 'no_base', 'no_base', 'no_base']);
  });

  it('never below the minimum price — such nights are marked «minimum»', async () => {
    const row = await pilotRow(setup({ settings: ON, min: 460 }));
    expect(row.nights[0]).toMatchObject({ status: 'minimum', after: 460 });
  });
});

describe('PricingAutoPriceService — daily run, «Только показывать»', () => {
  it('writes the journal only: nothing stored, nothing sent', async () => {
    const s = setup({ settings: ON, stays: TWO_OF_SIX });
    await s.svc.runAll();
    expect(s.dataSource.transaction).not.toHaveBeenCalled();
    expect(s.dates.runPricesAuto).not.toHaveBeenCalled();
    expect(s.stored.size).toBe(0);
    expect(s.runs).toHaveLength(1);
    expect(s.runs[0]).toMatchObject({
      propertyId: PILOT.id,
      dryRun: true,
      windowFrom: TODAY,
      windowTo: LAST,
      pct: -5,
      result: { changed: 4, cleared: 0, sent: null, failed: 0, mismatched: 0 },
    });
  });

  it('properties outside the pilot get no journal row', async () => {
    const s = setup({ settings: ON });
    await s.svc.runAll();
    expect(s.runs.map((r) => r.propertyId)).toEqual([PILOT.id]);
  });

  it('no saved rule → nothing runs at all', async () => {
    const s = setup();
    await s.svc.runAll();
    expect(s.runs).toEqual([]);
  });

  it('the journal is pruned', async () => {
    const s = setup({ settings: ON });
    await s.svc.runAll();
    expect(s.runRepo.delete).toHaveBeenCalledTimes(1);
  });
});

describe('PricingAutoPriceService — daily run, live', () => {
  it('stores the adjustments and sends the adjusted nights only (not other base prices)', async () => {
    const s = setup({ env: LIVE, settings: ON, stays: TWO_OF_SIX });
    await s.svc.runAll();
    expect(Object.fromEntries(s.stored)).toEqual({ '2026-11-25': -5, '2026-11-26': -5, '2026-11-27': -5, '2026-11-30': -5 });
    expect(sentOf(s)).toEqual([
      ['2026-11-25', 475],
      ['2026-11-26', 475],
      ['2026-11-27', 475],
      ['2026-11-30', 475],
    ]);
    expect(s.runs[0]).toMatchObject({ dryRun: false, result: { changed: 4, cleared: 0, sent: 1, failed: 0, mismatched: 0 } });
  });

  it('a night booked since yesterday loses its adjustment and goes back to the base', async () => {
    const s = setup({
      env: LIVE,
      settings: ON,
      stays: TWO_OF_SIX,
      stored: { '2026-11-25': -5, '2026-11-26': -5, '2026-11-27': -5, '2026-11-28': -10, '2026-11-30': -5 },
    });
    await s.svc.runAll();
    expect(s.stored.has('2026-11-28')).toBe(false);
    expect(new Map(sentOf(s)).get('2026-11-28')).toBe(500);
    expect(s.runs[0]!.result).toMatchObject({ changed: 0, cleared: 1 });
  });

  it('nothing changed since yesterday: nothing stored, still sent (the run sends only what differs on Booking)', async () => {
    const s = setup({
      env: LIVE,
      settings: ON,
      stays: TWO_OF_SIX,
      stored: { '2026-11-25': -5, '2026-11-26': -5, '2026-11-27': -5, '2026-11-30': -5 },
    });
    await s.svc.runAll();
    expect(s.dataSource.transaction).not.toHaveBeenCalled();
    expect(s.dates.runPricesAuto).toHaveBeenCalledTimes(1);
  });

  it('rule switched off: every adjustment is taken off and the base price sent back', async () => {
    const s = setup({ env: LIVE, settings: { enabled: false }, stored: { '2026-11-25': -5, '2026-11-26': -5 } });
    await s.svc.runAll();
    expect(s.stored.size).toBe(0);
    expect(sentOf(s)).toEqual([
      ['2026-11-25', 500],
      ['2026-11-26', 500],
    ]);
    expect(s.runs[0]).toMatchObject({ windowFrom: null, result: { changed: 0, cleared: 2 } });
  });

  it('rule switched off and nothing stored: no send, no journal', async () => {
    const s = setup({ env: LIVE, settings: { enabled: false } });
    await s.svc.runAll();
    expect(s.dates.runPricesAuto).not.toHaveBeenCalled();
    expect(s.runs).toEqual([]);
  });

  it('property left the pilot: adjustments removed in RentAI, Booking not written', async () => {
    const s = setup({ env: { ...LIVE, ZODOMUS_PROMOTIONS_PROPERTY_ALLOWLIST: 'someone-else' }, settings: ON, stored: { '2026-11-25': -5 } });
    await s.svc.runAll();
    expect(s.stored.size).toBe(0);
    expect(s.dates.runPricesAuto).not.toHaveBeenCalled();
    expect(s.runs.find((r) => r.propertyId === PILOT.id)!.result).toMatchObject({ cleared: 1, error: 'NOT_IN_PILOT' });
  });

  it('past nights are never touched', async () => {
    const s = setup({ env: LIVE, settings: { enabled: false }, stored: { '2026-11-20': -5 } });
    await s.svc.runAll();
    expect(s.stored.get('2026-11-20')).toBe(-5);
    expect(s.dates.runPricesAuto).not.toHaveBeenCalled();
  });

  it('another run of the property is going: BUSY in the journal, nothing stored — tomorrow computes it again', async () => {
    const s = setup({ env: LIVE, settings: ON, busy: true, stored: { '2026-11-25': -10 } });
    await s.svc.runAll();
    expect(Object.fromEntries(s.stored)).toEqual({ '2026-11-25': -10 });
    expect(s.dataSource.transaction).not.toHaveBeenCalled();
    expect(s.runs[0]!.result).toMatchObject({ sent: null, error: 'BUSY' });
  });

  it('Booking refuses: the error goes to the journal, nothing stored, the run itself does not fail', async () => {
    const s = setup({ env: LIVE, settings: ON, sendThrows: new Error('Слишком много запросов к Booking: 99') });
    await expect(s.svc.runAll()).resolves.toBeUndefined();
    expect(s.stored.size).toBe(0);
    expect(s.runs[0]!.result).toMatchObject({ error: 'Слишком много запросов к Booking: 99' });
  });

  it('the send goes out before anything is stored, with the new percents', async () => {
    const s = setup({ env: LIVE, settings: ON, stays: TWO_OF_SIX });
    s.dates.runPricesAuto.mockImplementationOnce(async (_id: string, targets: Map<string, number>) => {
      expect(s.stored.size).toBe(0);
      expect(targets.get('2026-11-25')).toBe(475);
      return null;
    });
    await s.svc.runAll();
    expect(s.dates.runPricesAuto).toHaveBeenCalledTimes(1);
  });

  it('a send that failed on Booking is counted; the adjustments are stored and sent again tomorrow', async () => {
    const s = setup({ env: LIVE, settings: ON, jobState: 'failed' });
    await s.svc.runAll();
    expect(s.runs[0]!.result).toMatchObject({ failed: 1, error: 'JOB_FAILED' });
    expect(s.stored.size).toBe(6);
  });

  it('a lowering never lifts a night that is already under the minimum', async () => {
    const row = await pilotRow(setup({ settings: ON, min: 600 }));
    expect(row.nights[0]).toMatchObject({ status: 'none', after: 500 });
  });

  it('promotions test mode: «Только показывать» even with the autoprice switch live', async () => {
    const s = setup({ env: { ...LIVE, ZODOMUS_PROMOTIONS_DRY_RUN: true }, settings: ON });
    await s.svc.runAll();
    expect(s.stored.size).toBe(0);
    expect(s.dates.runPricesAuto).not.toHaveBeenCalled();
    expect(s.runs[0]!.dryRun).toBe(true);
  });
});

describe('PricingAutoPriceService — the daily timer', () => {
  it('summer: 06:00 in Warsaw is 04:00 UTC', async () => {
    const s = setup({ settings: ON });
    const runAll = jest.spyOn(s.svc, 'runAll').mockResolvedValue();
    await s.svc.tick(new Date('2026-07-10T03:59:00Z'));
    expect(runAll).not.toHaveBeenCalled();
    await s.svc.tick(new Date('2026-07-10T04:00:00Z'));
    expect(runAll).toHaveBeenCalledTimes(1);
  });

  it('the Warsaw day decides «once a day»: 23:30 UTC is already the next day there', async () => {
    const s = setup({ settings: ON });
    const runAll = jest.spyOn(s.svc, 'runAll').mockResolvedValue();
    await s.svc.tick(new Date('2026-11-25T05:00:00Z')); // 25 Nov, 06:00 Warsaw
    await s.svc.tick(new Date('2026-11-25T23:30:00Z')); // 26 Nov, 00:30 Warsaw — before 06:00
    expect(runAll).toHaveBeenCalledTimes(1);
    await s.svc.tick(new Date('2026-11-26T05:00:00Z')); // 26 Nov, 06:00 Warsaw
    expect(runAll).toHaveBeenCalledTimes(2);
  });

  it('hour and zone from the environment; a broken zone falls back to Warsaw', async () => {
    const s = setup({ settings: ON, env: { ZODOMUS_PROMOTIONS_AUTOPRICE_HOUR: 8, ZODOMUS_PROMOTIONS_AUTOPRICE_TZ: 'Europe/Minsk' } });
    const runAll = jest.spyOn(s.svc, 'runAll').mockResolvedValue();
    await s.svc.tick(new Date('2026-11-25T04:59:00Z')); // 07:59 Minsk
    expect(runAll).not.toHaveBeenCalled();
    await s.svc.tick(new Date('2026-11-25T05:00:00Z')); // 08:00 Minsk
    expect(runAll).toHaveBeenCalledTimes(1);
    const o = await setup({ env: { ZODOMUS_PROMOTIONS_AUTOPRICE_TZ: 'Mars/Olympus' } }).svc.overview(OWNER);
    expect(o.timeZone).toBe('Europe/Warsaw');
    const empty = await setup({ env: { ZODOMUS_PROMOTIONS_AUTOPRICE_TZ: '  ' } }).svc.overview(OWNER);
    expect(empty.timeZone).toBe('Europe/Warsaw');
    const lower = await setup({ env: { ZODOMUS_PROMOTIONS_AUTOPRICE_TZ: 'europe/warsaw' } }).svc.overview(OWNER);
    expect(lower.timeZone).toBe('Europe/Warsaw');
  });

  it('winter: 06:00 in Warsaw is 05:00 UTC — before nothing, at the hour once a day, the next day again', async () => {
    const s = setup({ settings: ON });
    const runAll = jest.spyOn(s.svc, 'runAll').mockResolvedValue();
    await s.svc.tick(new Date('2026-11-25T04:59:00Z'));
    expect(runAll).not.toHaveBeenCalled();
    await s.svc.tick(new Date('2026-11-25T05:00:00Z'));
    await s.svc.tick(new Date('2026-11-25T13:00:00Z'));
    expect(runAll).toHaveBeenCalledTimes(1);
    await s.svc.tick(new Date('2026-11-26T05:01:00Z'));
    expect(runAll).toHaveBeenCalledTimes(2);
  });

  it('a failed run never escapes the timer', async () => {
    const s = setup({ settings: ON });
    jest.spyOn(s.svc, 'runAll').mockRejectedValue(new Error('db down'));
    await expect(s.svc.tick(new Date('2026-11-25T06:00:00Z'))).resolves.toBeUndefined();
  });

  it('settings table missing: the run logs and stops, no crash', async () => {
    const s = setup();
    s.settingsRepo.find.mockRejectedValueOnce(new Error('relation does not exist'));
    await expect(s.svc.runAll()).resolves.toBeUndefined();
    expect(s.runs).toEqual([]);
  });
});

describe('autoprice settings DTO', () => {
  const ok = { enabled: true, window: { kind: 'month_end', daysBefore: 7 }, down: [{ unsoldPct: 70, pct: 10 }], up: [] };
  it('a valid rule passes', () => {
    expect(autoPriceSettingsSchema.safeParse(ok).success).toBe(true);
  });
  it.each([
    ['window too long', { ...ok, window: { kind: 'next', days: 31 } }],
    ['«остаток месяца» too long', { ...ok, window: { kind: 'month_end', daysBefore: 15 } }],
    ['unknown window', { ...ok, window: { kind: 'week', days: 7 } }],
    ['percent over 50', { ...ok, down: [{ unsoldPct: 70, pct: 51 }] }],
    ['percent 0', { ...ok, down: [{ unsoldPct: 70, pct: 0 }] }],
    ['share over 100', { ...ok, up: [{ soldPct: 101, pct: 5 }] }],
    ['five tiers', { ...ok, down: [90, 80, 70, 60, 50].map((u) => ({ unsoldPct: u, pct: 5 })) }],
    ['extra field', { ...ok, extra: 1 }],
    ['enabled missing', { window: ok.window, down: ok.down, up: [] }],
  ])('%s → refused', (_n, body) => {
    expect(autoPriceSettingsSchema.safeParse(body).success).toBe(false);
  });
});
