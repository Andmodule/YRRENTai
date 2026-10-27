import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, MoreThanOrEqual, QueryFailedError, Repository } from 'typeorm';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { BookingEntity } from '../booking/entities/booking.entity';
import type { PropertyEntity } from '../property/entities/property.entity';
import { PropertyService } from '../property/property.service';
import { CalendarDatesService } from '../calendar-dates/calendar-dates.service';
import { PricingConfig } from './pricing-config';
import { PricingService } from './pricing.service';
import { PricingBasePriceService } from './pricing-base-price.service';
import {
  DEFAULT_AUTO_PRICE_SETTINGS,
  autoPriceWindow,
  diffAdjustments,
  pickAdjustment,
  planAutoNights,
  settingsProblem,
  sortDown,
  sortUp,
  type AutoNight,
  type AutoPriceSettings,
} from './autoprice.util';
import { addDaysYmd, nightsCount, todayInTz } from './pricing-math.util';
import { FREE_BOOKING_STATUSES, ymdInTz } from './pricing-occupancy.util';
import {
  PricingAutoPriceRunEntity,
  PricingAutoPriceSettingsEntity,
  PropertyAutoPriceEntity,
  type AutoPriceRunResult,
} from './entities/pricing-auto-price.entity';

/** Equal for the same rule — a save that changes nothing runs nothing. */
function settingsKey(s: AutoPriceSettings & { enabled: boolean }): string {
  return JSON.stringify([s.enabled, s.window, s.down, s.up]);
}

/** Bookings are stored as an instant near noon of the property day; widen the query like the calendar does. */
const TZ_SLACK_MS = 14 * 60 * 60 * 1000;
/** The journal keeps this many days. */
const JOURNAL_DAYS = 90;
/** Journal rows shown on the page. */
const JOURNAL_SHOWN = 30;

export type AutoPriceBlock = 'DATES_OFF' | 'NOT_ON_BOOKING' | 'NOT_IN_PILOT' | null;

export type AutoPriceRow = {
  propertyId: string;
  name: string;
  /** Why the rule leaves the property alone; null = it works on it. */
  block: AutoPriceBlock;
  /** Nights looked at today (inclusive); null while «остаток месяца» has not started. */
  window: { from: string; to: string } | null;
  totalNights: number;
  bookedNights: number;
  /** Whole percent sold, rounded down. */
  soldPct: number;
  /** Signed percent of the rule today. */
  pct: number;
  nights: AutoNight[];
  /** Nights whose adjustment the next run takes off (back to the base). */
  cleared: string[];
};

export type AutoPriceRunView = {
  id: string;
  propertyId: string;
  propertyName: string;
  runAt: string;
  dryRun: boolean;
  window: { from: string; to: string } | null;
  totalNights: number;
  bookedNights: number;
  pct: number;
  nights: Array<AutoNight & { cleared?: boolean }>;
  result: AutoPriceRunResult;
};

export type AutoPriceOverview = {
  /** «Только показывать»: runs only write the journal (env, or the promotions dry run). */
  dryRun: boolean;
  hourUtc: number;
  settings: AutoPriceSettings & { enabled: boolean; isDefault: boolean };
  properties: AutoPriceRow[];
  runs: AutoPriceRunView[];
};

export type AutoPriceSettingsInput = AutoPriceSettings & { enabled: boolean };

type Settings = AutoPriceSettings & { enabled: boolean; isDefault: boolean };

/**
 * «Цены → Автоцены» (ZODOMUS_PROMOTIONS_AUTOPRICE_ENABLED, off by default; needs «Базовая цена» and
 * «Открыть / закрыть даты», and the migration 1778800000000-pricing-auto-price).
 *
 * Once a day, for every property of the pilot list, the rule counts the booked share of its window and
 * puts a percent on the base price of the free nights (down when little is sold, up when much is). The
 * adjustment is stored per night and goes to Booking through the same runs as «Отправить в Booking»
 * (sold nights, minimum price, request limits, read-back). A night the rule no longer wants goes back to
 * the base. In «Только показывать» (the default) nothing is stored or sent — the journal says what would be.
 */
@Injectable()
export class PricingAutoPriceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PricingAutoPriceService.name);
  private timer: NodeJS.Timeout | null = null;
  private lastRunUtcDate: string | null = null;
  private running = false;
  /** Owners whose rule was saved while a run was going: run again right after it. */
  private readonly pending = new Set<string>();

  constructor(
    private readonly cfg: PricingConfig,
    private readonly pricing: PricingService,
    private readonly basePrice: PricingBasePriceService,
    private readonly dates: CalendarDatesService,
    private readonly propertyService: PropertyService,
    private readonly dataSource: DataSource,
    @InjectRepository(PricingAutoPriceSettingsEntity)
    private readonly settingsRepo: Repository<PricingAutoPriceSettingsEntity>,
    @InjectRepository(PropertyAutoPriceEntity)
    private readonly autoRepo: Repository<PropertyAutoPriceEntity>,
    @InjectRepository(PricingAutoPriceRunEntity)
    private readonly runRepo: Repository<PricingAutoPriceRunEntity>,
    @InjectRepository(BookingEntity)
    private readonly bookingRepo: Repository<BookingEntity>,
  ) {}

  onModuleInit(): void {
    if (!this.cfg.flags.autoPrice) return;
    this.logger.log(
      `Auto prices ENABLED — daily at ${String(this.cfg.flags.autoPriceHourUtc).padStart(2, '0')}:00 UTC, dryRun=${this.dryRun}`,
    );
    this.timer = setInterval(() => void this.tick(), 60_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Nothing is stored or sent: the rule's own switch, or Booking writes switched off altogether. */
  get dryRun(): boolean {
    return this.cfg.flags.autoPriceDryRun || this.cfg.flags.dryRun;
  }

  private assertOn(): void {
    this.pricing.assertEnabled();
    if (!this.cfg.flags.autoPrice) {
      throw new ServiceUnavailableException('Автоцены выключены (ZODOMUS_PROMOTIONS_AUTOPRICE_ENABLED=false)');
    }
  }

  /** The flag was switched on before the migration: say so instead of a bare 500. */
  private async tables<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      if (e instanceof QueryFailedError && (e as { driverError?: { code?: string } }).driverError?.code === '42P01') {
        throw new ServiceUnavailableException('Таблицы автоцен не созданы: запустите миграцию 1778800000000-pricing-auto-price');
      }
      throw e;
    }
  }

  // ─── settings ──────────────────────────────────────────────────────────────

  private async settingsOf(ownerId: string): Promise<Settings> {
    const row = await this.tables(() => this.settingsRepo.findOne({ where: { ownerId } }));
    if (!row) return { ...DEFAULT_AUTO_PRICE_SETTINGS, enabled: false, isDefault: true };
    return {
      enabled: row.enabled,
      window: row.windowKind === 'next' ? { kind: 'next', days: row.windowDays } : { kind: 'month_end', daysBefore: row.windowDays },
      down: sortDown(row.down ?? []),
      up: sortUp(row.up ?? []),
      isDefault: false,
    };
  }

  async saveSettings(user: JwtPayload, input: AutoPriceSettingsInput): Promise<AutoPriceOverview> {
    this.assertOn();
    const problem = settingsProblem(input);
    if (problem) throw new BadRequestException(problem);
    const { ownerId } = await this.pricing.actor(user);
    const before = await this.settingsOf(ownerId);
    await this.tables(() =>
      this.settingsRepo.upsert(
        {
          ownerId,
          enabled: input.enabled,
          windowKind: input.window.kind,
          windowDays: input.window.kind === 'next' ? input.window.days : input.window.daysBefore,
          down: sortDown(input.down),
          up: sortUp(input.up),
        },
        ['ownerId'],
      ),
    );
    // Live: a changed rule (switched off above all — prices back to the base) acts at once, not tomorrow.
    // In the background: the run reads and writes Booking, the save must not wait for it.
    if (!this.dryRun && settingsKey(before) !== settingsKey({ ...input, down: sortDown(input.down), up: sortUp(input.up) })) {
      this.runNow(ownerId);
    }
    return this.overview(user);
  }

  // ─── what the rule does ───────────────────────────────────────────────────

  /** Why the rule leaves the property alone (as for «Отправить в Booking»; an empty pilot list means «nobody»). */
  private blockOf(property: PropertyEntity): AutoPriceBlock {
    const block = this.basePrice.bookingSendBlock(property);
    // DRY_RUN is not a block here: the rule still computes and writes the journal («Только показывать»).
    return block === 'DRY_RUN' ? null : block;
  }

  /** Nights of [from, to] taken by a booking (RentAI bookings of every channel, cancelled ones left out). */
  private async bookedSet(property: PropertyEntity, from: string, to: string): Promise<Set<string>> {
    const rows = await this.bookingRepo
      .createQueryBuilder('b')
      .select(['b.id', 'b.checkIn', 'b.checkOut'])
      .where('b.propertyId = :id', { id: property.id })
      .andWhere('b.checkIn < :end', { end: new Date(Date.parse(`${addDaysYmd(to, 1)}T00:00:00.000Z`) + TZ_SLACK_MS) })
      .andWhere('b.checkOut > :start', { start: new Date(Date.parse(`${from}T00:00:00.000Z`) - TZ_SLACK_MS) })
      .andWhere('b.status NOT IN (:...free)', { free: [...FREE_BOOKING_STATUSES] })
      .getMany();
    const taken = new Set<string>();
    for (const b of rows) {
      const ci = ymdInTz(b.checkIn, property.timezone);
      const co = ymdInTz(b.checkOut, property.timezone);
      for (let d = ci < from ? from : ci, i = 0; d < co && d <= to && i < 400; d = addDaysYmd(d, 1), i++) taken.add(d);
    }
    return taken;
  }

  /** What the rule does to the property today, from the stored adjustments — reads RentAI only. */
  async compute(
    property: PropertyEntity,
    settings: Settings,
  ): Promise<{ row: AutoPriceRow; set: Map<string, number>; current: Map<string, number> }> {
    const block = this.blockOf(property);
    const today = todayInTz(property.timezone);
    const current = new Map(
      (await this.autoRepo.find({ where: { propertyId: property.id, date: MoreThanOrEqual(today) } })).map((r) => [r.date, r.pct]),
    );
    const window = settings.enabled && !block ? autoPriceWindow(today, settings.window) : null;
    const empty: AutoPriceRow = {
      propertyId: property.id,
      name: property.name,
      block,
      window,
      totalNights: 0,
      bookedNights: 0,
      soldPct: 0,
      pct: 0,
      nights: [],
      cleared: [],
    };
    if (!window) {
      // Silent today (or switched off / out of the pilot): whatever it put on goes back to the base.
      const { clear } = diffAdjustments(current, new Map(), today);
      return { row: { ...empty, cleared: clear }, set: new Map(), current };
    }
    const total = nightsCount(window.from, window.to);
    const [booked, source, markup, min] = await Promise.all([
      this.bookedSet(property, window.from, window.to),
      this.basePrice.nightsSource(property.id, window.from, window.to),
      this.basePrice.bookingMarkup(property.id),
      this.dates.minPriceOf(property.id),
    ]);
    const pct = pickAdjustment(booked.size, total, settings);
    const inputs = [];
    for (let d = window.from; d <= window.to; d = addDaysYmd(d, 1)) {
      inputs.push({ date: d, booked: booked.has(d), base: source.base.get(d) ?? null, typed: source.typed.has(d) });
    }
    const nights = planAutoNights(inputs, pct, markup, min);
    const wanted = new Map(nights.filter((n) => n.status === 'adjusted' || n.status === 'minimum').map((n) => [n.date, n.pct]));
    const { set, clear } = diffAdjustments(current, wanted, today);
    return {
      row: {
        ...empty,
        totalNights: total,
        bookedNights: booked.size,
        soldPct: total > 0 ? Math.floor((booked.size * 100) / total) : 0,
        pct,
        nights,
        cleared: clear,
      },
      set,
      current,
    };
  }

  // ─── page ──────────────────────────────────────────────────────────────────

  async overview(user: JwtPayload): Promise<AutoPriceOverview> {
    this.assertOn();
    const { ownerId } = await this.pricing.actor(user);
    const settings = await this.settingsOf(ownerId);
    const properties = await this.propertyService.findAllByOwner(ownerId);
    const rows = await this.tables(() =>
      Promise.all(
        properties.map(async (p) => {
          // Off the pilot / not on Booking: listed, not computed (no reads for 48 properties of nothing).
          if (this.blockOf(p)) return this.blockedRow(p);
          return (await this.compute(p, settings)).row;
        }),
      ),
    );
    const names = new Map(properties.map((p) => [p.id, p.name]));
    const runs = properties.length
      ? await this.tables(() =>
          this.runRepo.find({
            where: { propertyId: In(properties.map((p) => p.id)) },
            order: { runAt: 'DESC' },
            take: JOURNAL_SHOWN,
          }),
        )
      : [];
    return {
      dryRun: this.dryRun,
      hourUtc: this.cfg.flags.autoPriceHourUtc,
      settings,
      // Properties the rule works on first.
      properties: rows.sort((a, b) => Number(a.block != null) - Number(b.block != null)),
      runs: runs.map((r) => ({
        id: r.id,
        propertyId: r.propertyId,
        propertyName: names.get(r.propertyId) ?? '',
        runAt: r.runAt.toISOString(),
        dryRun: r.dryRun,
        window: r.windowFrom && r.windowTo ? { from: r.windowFrom, to: r.windowTo } : null,
        totalNights: r.totalNights,
        bookedNights: r.bookedNights,
        pct: r.pct,
        nights: r.nights,
        result: r.result,
      })),
    };
  }

  private blockedRow(p: PropertyEntity): AutoPriceRow {
    return {
      propertyId: p.id,
      name: p.name,
      block: this.blockOf(p),
      window: null,
      totalNights: 0,
      bookedNights: 0,
      soldPct: 0,
      pct: 0,
      nights: [],
      cleared: [],
    };
  }

  // ─── daily run ─────────────────────────────────────────────────────────────

  /** Once per UTC day, at or after the configured hour (a restart later that day runs it then). */
  async tick(now: Date = new Date()): Promise<void> {
    if (!this.cfg.flags.autoPrice || this.running) return;
    if (now.getUTCHours() < this.cfg.flags.autoPriceHourUtc) return;
    const day = now.toISOString().slice(0, 10);
    if (this.lastRunUtcDate === day) return;
    this.lastRunUtcDate = day;
    try {
      await this.runAll();
    } catch (e) {
      // Called from setInterval: an escaping rejection would take the whole process down.
      this.logger.error(`auto prices run failed: ${e instanceof Error ? e.stack : String(e)}`);
    }
  }

  /** One owner right after a save; while another run is going, queued to run right after it. */
  runNow(ownerId: string): void {
    this.pending.add(ownerId);
    if (this.running) return;
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.size) {
        const ownerId = this.pending.values().next().value as string;
        this.pending.delete(ownerId);
        await this.runOwner(ownerId);
      }
    } finally {
      this.running = false;
    }
  }

  async runAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let owners: PricingAutoPriceSettingsEntity[];
      try {
        owners = await this.settingsRepo.find();
      } catch (e) {
        this.logger.error(`auto prices: settings unreadable (migration 1778800000000 not run?): ${String(e)}`);
        return;
      }
      for (const row of owners) await this.runOwner(row.ownerId);
      await this.runRepo.delete({ runAt: LessThan(new Date(Date.now() - JOURNAL_DAYS * 86_400_000)) });
    } finally {
      this.running = false;
    }
    // Rules saved during the run: their owners may have been read before the save.
    if (this.pending.size) await this.drain();
  }

  /** Every property of one owner; one owner or property failing never stops the others. */
  private async runOwner(ownerId: string): Promise<void> {
    try {
      const settings = await this.settingsOf(ownerId);
      for (const p of await this.propertyService.findAllByOwner(ownerId)) {
        try {
          await this.runOne(p, settings);
        } catch (e) {
          this.logger.error(`auto prices property=${p.id} failed: ${e instanceof Error ? e.stack : String(e)}`);
        }
      }
    } catch (e) {
      this.logger.error(`auto prices owner=${ownerId} failed: ${e instanceof Error ? e.stack : String(e)}`);
    }
  }

  /**
   * One property: compute, send and then store the adjustments (unless «Только показывать»), write the journal.
   * A switched-off rule or a property that left the pilot still runs once to take its adjustments off.
   */
  async runOne(property: PropertyEntity, settings: Settings): Promise<void> {
    const { row, set, current } = await this.compute(property, settings);
    const touches = set.size > 0 || row.cleared.length > 0;
    // Nothing to do and nothing to say: no journal row for properties the rule does not concern.
    if (!row.window && !touches) return;
    const dryRun = this.dryRun;
    const result: AutoPriceRunResult = { changed: set.size, cleared: row.cleared.length, sent: null, failed: 0, mismatched: 0 };

    if (!dryRun && row.block == null) {
      try {
        // What the nights will carry after this run — sent first, stored only once Booking took the run.
        const next = new Map(current);
        for (const d of row.cleared) next.delete(d);
        for (const [d, pct] of set) next.set(d, pct);
        // Every night that carries an adjustment plus the cleared ones, every day: the run compares with what
        // Booking has and sends only the difference, so a send that failed yesterday is made good today.
        const dates = [...new Set([...next.keys(), ...row.cleared])].sort();
        let reached = true;
        if (dates.length) {
          const all = await this.basePrice.bookingTargets(property.id, dates[0]!, dates[dates.length - 1]!, next);
          const wanted = new Set(dates);
          const targets = new Map([...all].filter(([d]) => wanted.has(d)));
          const res = await this.dates.runPricesAuto(property.id, targets);
          if (!res) {
            // Another run of the property is going: nothing stored, tomorrow computes it again.
            result.error = 'BUSY';
            reached = false;
          } else {
            result.sent = res.ranges.length;
            if (res.job) {
              result.failed = res.job.failed.reduce(
                (sum, f) => sum + res.plan.changes.filter((c) => c.date >= f.dateFrom && c.date < f.dateToExclusive).length,
                0,
              );
              result.mismatched = res.job.verify?.mismatched.length ?? 0;
              if (res.job.state === 'failed' || res.job.state === 'stopped') result.error = `JOB_${res.job.state.toUpperCase()}`;
            }
          }
        } else {
          result.sent = 0;
        }
        // A run that reached Booking is stored even when some nights failed: the calendar marks them «not sent»
        // and tomorrow's run sends them again.
        if (reached && touches) await this.store(property.id, set, row.cleared);
      } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
        this.logger.warn(`auto prices property=${property.id} failed: ${result.error}`);
      }
    } else if (!dryRun && touches && row.block != null) {
      // Left the pilot: its adjustments are only taken off in RentAI — Booking is not written for it any more.
      try {
        await this.autoRepo.delete({ propertyId: property.id, date: In(row.cleared) });
        result.error = row.block;
      } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
      }
    }

    const changedNights = row.nights.filter((n) => set.has(n.date));
    await this.runRepo.insert({
      propertyId: property.id,
      dryRun,
      windowFrom: row.window?.from ?? null,
      windowTo: row.window?.to ?? null,
      totalNights: row.totalNights,
      bookedNights: row.bookedNights,
      pct: row.pct,
      nights: [...changedNights, ...row.cleared.map((date) => ({ date, status: 'none' as const, pct: 0, before: null, after: null, cleared: true }))],
      result,
    });
  }

  private async store(propertyId: string, set: ReadonlyMap<string, number>, cleared: readonly string[]): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(PropertyAutoPriceEntity);
      if (cleared.length) await repo.delete({ propertyId, date: In([...cleared]) });
      if (set.size) await repo.upsert([...set].map(([date, pct]) => ({ propertyId, date, pct })), ['propertyId', 'date']);
    });
  }
}
