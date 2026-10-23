import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { formatInTimeZone } from 'date-fns-tz';
import { Repository } from 'typeorm';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { PropertyEntity } from '../property/entities/property.entity';
import { PropertyService } from '../property/property.service';
import { PropertyPricingSettingsEntity } from '../pricing/entities/property-pricing-settings.entity';
import { ZodomusService } from '../integrations/zodomus/zodomus.service';
import { ZodomusSyncService } from '../integrations/zodomus/zodomus-sync.service';
import { ZodomusRatesPushService, type PushTarget } from '../integrations/zodomus/zodomus-rates-push.service';
import {
  buildRateNameMapFromRoomRates,
  extractRoomsFromRoomRatesBody,
  pickPrimaryRateId,
} from '../integrations/zodomus/zodomus-room-rates.util';
import { formatZodomusHttpException } from '../integrations/zodomus/zodomus-status.util';
import {
  extractCurrencyFromZodomusPayload,
  resolveOtaChannelCurrency,
} from '../integrations/zodomus/zodomus-reservation-price.util';
import {
  MAX_RANGE_NIGHTS,
  MAX_WRITE_REQUESTS,
  addDaysYmd,
  countChanges,
  emptySkipped,
  extractRateNights,
  findMismatches,
  mergeChangesToRanges,
  nightsBetween,
  planCalendarDates,
  planPriceTargets,
  splitWindows,
  type CalendarDatesAction,
  type CalendarDatesJobAction,
  type CalendarDatesPlan,
  type CalendarDatesPlanInput,
  type ChangeRange,
  type NightChange,
  type RateNight,
  type SkipReason,
} from './calendar-dates.util';

function toBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(s)) return true;
    if (['false', '0', 'no'].includes(s)) return false;
  }
  return fallback;
}

export function todayInTz(tz: string | null | undefined, now: Date = new Date()): string {
  try {
    return formatInTimeZone(now, tz?.trim() || 'UTC', 'yyyy-MM-dd');
  } catch {
    return formatInTimeZone(now, 'UTC', 'yyyy-MM-dd');
  }
}

/** GET /availability windows read for a preview are reused by «apply» within this time. */
const WINDOW_CACHE_TTL_MS = 2 * 60_000;
/** Stop a run after this many failed POST /rates in a row (channel down, access lost). */
const MAX_FAILURES_IN_A_ROW = 3;
/** Runs shown in the preview. */
const PREVIEW_RANGES = 10;

type Ctx = {
  property: PropertyEntity;
  target: PushTarget;
  roomId: string;
  rateId: string;
  rateName: string | null;
  currency: string;
  tz: string;
  minPrice: number | null;
};

export type CalendarDatesRequest = CalendarDatesPlanInput & { propertyId: string };

export type CalendarDatesPreview = {
  propertyId: string;
  /** Shown next to the confirmation, so the wrong property cannot slip through. */
  propertyName: string;
  action: CalendarDatesJobAction;
  dateFrom: string;
  dateToExclusive: string;
  rate: { id: string; name: string | null };
  currency: string;
  minPrice: number | null;
  nights: number;
  changes: { open: number; close: number; price: number };
  skipped: Record<SkipReason, number>;
  /** POST /rates the run needs. */
  requests: number;
  /** Rough duration at the global Zodomus pace (writes + read-back). */
  estimateSeconds: number;
  /** More writes than one run may send: ask for a shorter range or one price. */
  tooMany: boolean;
  ranges: ChangeRange[];
  /** «close»: nights already closed on Booking — nothing to send, auto-extension will leave them closed. */
  alreadyClosed: number;
};

export type CalendarDatesJobState = 'running' | 'done' | 'failed' | 'stopped';

export type CalendarDatesJob = {
  id: string;
  propertyId: string;
  source: 'manual' | 'auto';
  action: CalendarDatesJobAction;
  dateFrom: string;
  dateToExclusive: string;
  state: CalendarDatesJobState;
  phase: 'sending' | 'verifying' | 'finished';
  /** POST /rates to send / sent. */
  total: number;
  sent: number;
  failed: { dateFrom: string; dateToExclusive: string; detail: string }[];
  /** Planned. */
  changes: { open: number; close: number; price: number };
  /** Accepted by Booking (null while sending). */
  applied: { open: number; close: number; price: number } | null;
  /** Read back from Booking after the writes. null = not done (yet) or could not be read. */
  verify: { checked: number; mismatched: string[]; error?: string } | null;
  startedAt: string;
  finishedAt: string | null;
};

/**
 * Called after a run with the nights Booking accepted and, on «close», the nights that were closed
 * already (auto-extension keeps its «leave closed» list).
 */
export type CalendarDatesAppliedListener = (
  propertyId: string,
  action: CalendarDatesJobAction,
  applied: NightChange[],
  alreadyClosed: string[],
) => Promise<void>;

/**
 * «Открыть / закрыть даты на Booking» (ZODOMUS_CALENDAR_DATES_ENABLED, off by default).
 *
 * Booking blocks inventory and price edits in the extranet for properties connected through a channel
 * manager, so nights that were never opened stay closed until RentAI opens them. One run = one
 * property, one Booking room + its main rate (the same one «Цена на канале» uses). Nights sold on
 * Booking or covered by a booking / block in RentAI are never touched. Writes are serialized by the
 * global Zodomus limiter; the run continues in the background and is read back from Booking at the end.
 */
@Injectable()
export class CalendarDatesService {
  private readonly logger = new Logger(CalendarDatesService.name);
  /** Last run per property — in memory: a restart forgets the report, Booking keeps what was sent. */
  private readonly jobs = new Map<string, CalendarDatesJob>();
  private readonly windowCache = new Map<string, { at: number; body: unknown }>();
  private appliedListener: CalendarDatesAppliedListener | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly zodomus: ZodomusService,
    private readonly ratesPush: ZodomusRatesPushService,
    private readonly zodomusSync: ZodomusSyncService,
    private readonly propertyService: PropertyService,
    @InjectRepository(PropertyEntity)
    private readonly propertyRepo: Repository<PropertyEntity>,
    @InjectRepository(PropertyPricingSettingsEntity)
    private readonly pricingSettingsRepo: Repository<PropertyPricingSettingsEntity>,
  ) {}

  get enabled(): boolean {
    return this.zodomus.isEnabled && toBool(this.config.get('ZODOMUS_CALENDAR_DATES_ENABLED'), false);
  }

  private get channelId(): number {
    const n = Number(this.config.get('ZODOMUS_PROMOTIONS_CHANNEL_ID') ?? 1);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  private get perMinute(): number {
    const n = Number(this.config.get('ZODOMUS_MAX_REQUESTS_PER_MINUTE') ?? 20);
    return Number.isFinite(n) && n > 0 ? n : 20;
  }

  /**
   * RentAI pushes availability (and sends availability 0 for new bookings) only up to this many days
   * ahead. A night opened further than that could be sold twice: never open beyond it.
   */
  get availabilityHorizonDays(): number {
    const n = Number(this.config.get('ZODOMUS_AVAILABILITY_HORIZON_DAYS') ?? 366);
    return Number.isInteger(n) && n > 0 ? n : 366;
  }

  /** Exclusive end of what may be opened for a property today. */
  horizonEnd(tz: string | null | undefined): string {
    return addDaysYmd(todayInTz(tz), this.availabilityHorizonDays);
  }

  setAppliedListener(fn: CalendarDatesAppliedListener): void {
    this.appliedListener = fn;
  }

  assertEnabled(): void {
    if (!this.enabled) {
      throw new ServiceUnavailableException(
        'Открытие и закрытие дат выключено (ZODOMUS_CALENDAR_DATES_ENABLED=false)',
      );
    }
  }

  async assertAccess(user: JwtPayload, propertyId: string): Promise<void> {
    await this.propertyService.findOneForUser(propertyId, user.sub, user.role);
  }

  // ─── context ───────────────────────────────────────────────────────────────

  private async context(propertyId: string): Promise<Ctx> {
    const property = await this.propertyRepo.findOne({
      where: { id: propertyId },
      relations: ['otaPlatform', 'channelListings', 'channelListings.otaPlatform'],
    });
    if (!property) throw new NotFoundException('Объект не найден');
    const target = this.ratesPush.buildPushTargets(property).find((t) => t.channelId === this.channelId);
    if (!target) throw new BadRequestException('Объект не подключён к Booking через Zodomus');
    const ratesRaw = await this.zodomus.getRoomRatesRaw(target.channelId, target.extProp);
    // Without a saved room the first Booking room would be taken — the wrong one if there are several.
    const stored = target.storedRoomId?.trim();
    if ((!stored || stored === target.extProp) && extractRoomsFromRoomRatesBody(ratesRaw).length > 1) {
      throw new BadRequestException(
        'У объекта на Booking несколько номеров — укажите номер Zodomus (room id) в карточке объекта',
      );
    }
    const roomId = await this.ratesPush.resolveRoomId(property, target);
    if (!roomId) throw new BadRequestException('Booking не вернул номер объекта (GET /room-rates)');
    const rateId = pickPrimaryRateId(ratesRaw, roomId);
    if (!rateId) throw new BadRequestException('Booking не вернул тариф объекта (GET /room-rates)');
    const rateName = buildRateNameMapFromRoomRates(ratesRaw)[rateId] ?? null;
    const tz = property.timezone?.trim() || 'UTC';
    return {
      property,
      target,
      roomId,
      rateId,
      rateName,
      currency: resolveOtaChannelCurrency({ propertyCurrency: property.currency, timezone: tz }),
      tz,
      minPrice: await this.minPriceOf(property.id),
    };
  }

  /** «Цены → Минимальные цены» of the property in major units; null = not set. */
  async minPriceOf(propertyId: string): Promise<number | null> {
    try {
      const row = await this.pricingSettingsRepo.findOne({ where: { propertyId } });
      return row?.minPriceMinor != null ? row.minPriceMinor / 100 : null;
    } catch (e) {
      // «Цены» not migrated on this database: no minimum to check against.
      this.logger.warn(`minimum price unavailable for ${propertyId}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  private validate(ctx: Ctx, input: CalendarDatesPlanInput): void {
    const nights = nightsBetween(input.dateFrom, input.dateToExclusive);
    if (!Number.isFinite(nights) || nights < 1) {
      throw new BadRequestException('Неверные даты');
    }
    const today = todayInTz(ctx.tz);
    if (input.dateFrom < today) {
      throw new BadRequestException(`Прошедшие даты не меняются: начните с ${today} или позже`);
    }
    if (nights > MAX_RANGE_NIGHTS) {
      throw new BadRequestException(`Не больше ${MAX_RANGE_NIGHTS} ночей за один раз`);
    }
    const end = this.horizonEnd(ctx.tz);
    if (input.dateToExclusive > end) {
      throw new BadRequestException(
        `Не дальше ${addDaysYmd(end, -1)}: дальше RentAI не выгружает наличие на Booking, и открытая дата могла бы продаться дважды`,
      );
    }
    if (input.action === 'open' && ctx.minPrice != null) {
      for (const p of [input.price, input.weekendPrice]) {
        if (p != null && p < ctx.minPrice) {
          throw new BadRequestException(
            `Цена ${p} ниже минимальной цены объекта (${ctx.minPrice} ${ctx.currency}) — «Цены → Минимальные цены»`,
          );
        }
      }
    }
  }

  /** Rate nights of [from, toExclusive), read window by window (≤ 28 nights each). */
  private async readNights(
    ctx: Ctx,
    from: string,
    toExclusive: string,
    fresh: boolean,
  ): Promise<Map<string, RateNight>> {
    const out = new Map<string, RateNight>();
    let currencySeen = false;
    for (const w of splitWindows(from, toExclusive)) {
      const key = `${ctx.property.id}:${ctx.target.extProp}:${w.dateFrom}:${w.dateToExclusive}`;
      const hit = this.windowCache.get(key);
      let body: unknown;
      if (!fresh && hit && Date.now() - hit.at < WINDOW_CACHE_TTL_MS) {
        body = hit.body;
      } else {
        body = await this.zodomus.getAvailability(ctx.target.channelId, ctx.target.extProp, w.dateFrom, w.dateToExclusive);
        this.pruneWindowCache();
        this.windowCache.set(key, { at: Date.now(), body });
      }
      if (!currencySeen) {
        currencySeen = true;
        ctx.currency = resolveOtaChannelCurrency({
          fromAri: extractCurrencyFromZodomusPayload(body),
          propertyCurrency: ctx.property.currency,
          timezone: ctx.tz,
        });
      }
      for (const [date, night] of extractRateNights(body, ctx.roomId, ctx.rateId)) out.set(date, night);
    }
    return out;
  }

  private dropWindowCache(propertyId: string): void {
    for (const key of [...this.windowCache.keys()]) {
      if (key.startsWith(`${propertyId}:`)) this.windowCache.delete(key);
    }
  }

  private pruneWindowCache(): void {
    const now = Date.now();
    for (const [key, hit] of this.windowCache) {
      if (now - hit.at >= WINDOW_CACHE_TTL_MS) this.windowCache.delete(key);
    }
  }

  private async plan(
    ctx: Ctx,
    input: CalendarDatesPlanInput,
    opts: { keepClosed?: ReadonlySet<string> } = {},
  ): Promise<{ plan: CalendarDatesPlan; ranges: ChangeRange[] }> {
    const nights = await this.readNights(ctx, input.dateFrom, input.dateToExclusive, false);
    const crmBlocked = await this.ratesPush.collectCrmBlockedNightKeys(ctx.property, input.dateFrom, input.dateToExclusive);
    const plan = planCalendarDates(nights, input, { crmBlocked, keepClosed: opts.keepClosed, minPrice: ctx.minPrice });
    return { plan, ranges: mergeChangesToRanges(plan.changes) };
  }

  private estimateSeconds(writes: number, from: string, toExclusive: string): number {
    const reads = splitWindows(from, toExclusive).length;
    return Math.ceil(((writes + reads) * 60) / this.perMinute);
  }

  // ─── API ───────────────────────────────────────────────────────────────────

  /** What a run would change. Reads Booking, writes nothing. */
  async preview(user: JwtPayload, input: CalendarDatesRequest): Promise<CalendarDatesPreview> {
    this.assertEnabled();
    await this.assertAccess(user, input.propertyId);
    const ctx = await this.context(input.propertyId);
    this.validate(ctx, input);
    const { plan, ranges } = await this.plan(ctx, input);
    return {
      propertyId: ctx.property.id,
      propertyName: ctx.property.name,
      action: input.action,
      dateFrom: input.dateFrom,
      dateToExclusive: input.dateToExclusive,
      rate: { id: ctx.rateId, name: ctx.rateName },
      currency: ctx.currency,
      minPrice: ctx.minPrice,
      nights: plan.nights,
      changes: countChanges(plan.changes),
      skipped: plan.skipped,
      requests: ranges.length,
      estimateSeconds: ranges.length ? this.estimateSeconds(ranges.length, input.dateFrom, input.dateToExclusive) : 0,
      tooMany: ranges.length > MAX_WRITE_REQUESTS,
      ranges: ranges.slice(0, PREVIEW_RANGES),
      alreadyClosed: plan.alreadyClosed.length,
    };
  }

  /** Starts the run in the background; the report is read with `job()`. */
  async start(user: JwtPayload, input: CalendarDatesRequest): Promise<CalendarDatesJob> {
    this.assertEnabled();
    await this.assertAccess(user, input.propertyId);
    this.assertIdle(input.propertyId);
    const ctx = await this.context(input.propertyId);
    this.validate(ctx, input);
    const { plan, ranges } = await this.plan(ctx, input);
    if (ranges.length > MAX_WRITE_REQUESTS) {
      throw new BadRequestException(
        `Слишком много разных цен: ${ranges.length} запросов к Booking (не больше ${MAX_WRITE_REQUESTS}) — выберите диапазон короче или одну цену`,
      );
    }
    // The checks above awaited Booking: another run may have started meanwhile.
    this.assertIdle(input.propertyId);
    const job = this.newJob(ctx, input, 'manual', plan, ranges);
    void this.execute(ctx, job, plan.changes, ranges, plan.alreadyClosed).catch((e) => {
      job.state = 'failed';
      job.phase = 'finished';
      job.finishedAt = new Date().toISOString();
      this.logger.error(`calendar dates run ${job.id} crashed: ${e instanceof Error ? e.stack : String(e)}`);
    });
    return { ...job };
  }

  async job(user: JwtPayload, propertyId: string): Promise<CalendarDatesJob | null> {
    this.assertEnabled();
    await this.assertAccess(user, propertyId);
    const job = this.jobs.get(propertyId);
    return job ? { ...job, failed: [...job.failed], verify: job.verify ? { ...job.verify } : null } : null;
  }

  isBusy(propertyId: string): boolean {
    return this.jobs.get(propertyId)?.state === 'running';
  }

  private assertIdle(propertyId: string): void {
    if (this.isBusy(propertyId)) {
      throw new ConflictException('Для этого объекта уже идёт отправка дат на Booking — дождитесь отчёта');
    }
  }

  /**
   * Auto-extension: plan and (unless dry run) send, waiting for the end. Returns null when a run is
   * already going for the property (try again next time).
   */
  async runAuto(
    propertyId: string,
    input: CalendarDatesPlanInput,
    opts: { keepClosed: ReadonlySet<string>; dryRun: boolean },
  ): Promise<{ plan: CalendarDatesPlan; ranges: ChangeRange[]; job: CalendarDatesJob | null } | null> {
    if (this.isBusy(propertyId)) return null;
    const ctx = await this.context(propertyId);
    const today = todayInTz(ctx.tz);
    const from = input.dateFrom < today ? today : input.dateFrom;
    const horizon = this.horizonEnd(ctx.tz);
    const to = input.dateToExclusive > horizon ? horizon : input.dateToExclusive;
    if (from >= to) {
      return { plan: { nights: 0, changes: [], skipped: emptySkipped(), alreadyClosed: [] }, ranges: [], job: null };
    }
    const scoped = { ...input, dateFrom: from, dateToExclusive: to };
    // Checked when the settings are saved too; the minimum may have been raised since.
    if (ctx.minPrice != null && [scoped.price, scoped.weekendPrice].some((p) => p != null && p < ctx.minPrice!)) {
      throw new BadRequestException(`Цена автопродления ниже минимальной цены объекта (${ctx.minPrice})`);
    }
    const { plan, ranges } = await this.plan(ctx, scoped, { keepClosed: opts.keepClosed });
    if (opts.dryRun || ranges.length === 0) return { plan, ranges, job: null };
    if (ranges.length > MAX_WRITE_REQUESTS) {
      throw new BadRequestException(`Слишком много запросов к Booking: ${ranges.length}`);
    }
    if (this.isBusy(propertyId)) return null;
    const job = this.newJob(ctx, scoped, 'auto', plan, ranges);
    await this.execute(ctx, job, plan.changes, ranges);
    return { plan, ranges, job: { ...job } };
  }

  // ─── «Цены → базовая цена»: re-price nights ────────────────────────────────

  /**
   * Target prices the run may touch: from today (property time zone) up to the availability horizon,
   * at most MAX_RANGE_NIGHTS from the first to the last. Nothing left → 400.
   */
  private scopePriceTargets(ctx: Ctx, targets: ReadonlyMap<string, number>): {
    targets: Map<string, number>;
    dateFrom: string;
    dateToExclusive: string;
  } {
    const today = todayInTz(ctx.tz);
    const end = this.horizonEnd(ctx.tz);
    const scoped = new Map([...targets].filter(([d]) => d >= today && d < end).sort(([a], [b]) => a.localeCompare(b)));
    if (scoped.size === 0) {
      throw new BadRequestException('Нет ночей с ценой от сегодняшнего дня до горизонта календаря');
    }
    const dates = [...scoped.keys()];
    const dateFrom = dates[0]!;
    const dateToExclusive = addDaysYmd(dates[dates.length - 1]!, 1);
    if (nightsBetween(dateFrom, dateToExclusive) > MAX_RANGE_NIGHTS) {
      throw new BadRequestException(`Не больше ${MAX_RANGE_NIGHTS} ночей за один раз`);
    }
    return { targets: scoped, dateFrom, dateToExclusive };
  }

  private async planPrices(
    ctx: Ctx,
    scope: { targets: Map<string, number>; dateFrom: string; dateToExclusive: string },
  ): Promise<{ plan: CalendarDatesPlan; ranges: ChangeRange[] }> {
    const nights = await this.readNights(ctx, scope.dateFrom, scope.dateToExclusive, false);
    const crmBlocked = await this.ratesPush.collectCrmBlockedNightKeys(ctx.property, scope.dateFrom, scope.dateToExclusive);
    const plan = planPriceTargets(nights, scope.targets, { crmBlocked, minPrice: ctx.minPrice });
    return { plan, ranges: mergeChangesToRanges(plan.changes) };
  }

  /** What re-pricing to `targets` (night → price) would change on Booking. Reads Booking, writes nothing. */
  async previewPrices(user: JwtPayload, propertyId: string, targets: ReadonlyMap<string, number>): Promise<CalendarDatesPreview> {
    this.assertEnabled();
    await this.assertAccess(user, propertyId);
    const ctx = await this.context(propertyId);
    const scope = this.scopePriceTargets(ctx, targets);
    const { plan, ranges } = await this.planPrices(ctx, scope);
    return {
      propertyId: ctx.property.id,
      propertyName: ctx.property.name,
      action: 'price',
      dateFrom: scope.dateFrom,
      dateToExclusive: scope.dateToExclusive,
      rate: { id: ctx.rateId, name: ctx.rateName },
      currency: ctx.currency,
      minPrice: ctx.minPrice,
      nights: plan.nights,
      changes: countChanges(plan.changes),
      skipped: plan.skipped,
      requests: ranges.length,
      estimateSeconds: ranges.length ? this.estimateSeconds(ranges.length, scope.dateFrom, scope.dateToExclusive) : 0,
      tooMany: ranges.length > MAX_WRITE_REQUESTS,
      ranges: ranges.slice(0, PREVIEW_RANGES),
      alreadyClosed: 0,
    };
  }

  /** Re-prices the nights in the background, open / closed state kept; the report is read with `job()`. */
  async startPrices(user: JwtPayload, propertyId: string, targets: ReadonlyMap<string, number>): Promise<CalendarDatesJob> {
    this.assertEnabled();
    await this.assertAccess(user, propertyId);
    this.assertIdle(propertyId);
    const ctx = await this.context(propertyId);
    const scope = this.scopePriceTargets(ctx, targets);
    const { plan, ranges } = await this.planPrices(ctx, scope);
    if (ranges.length === 0) {
      throw new BadRequestException('На Booking уже эти цены — отправлять нечего');
    }
    if (ranges.length > MAX_WRITE_REQUESTS) {
      throw new BadRequestException(
        `Слишком много разных цен: ${ranges.length} запросов к Booking (не больше ${MAX_WRITE_REQUESTS}) — выберите диапазон короче`,
      );
    }
    this.assertIdle(propertyId);
    const job = this.newJob(ctx, { action: 'price', dateFrom: scope.dateFrom, dateToExclusive: scope.dateToExclusive }, 'manual', plan, ranges);
    void this.execute(ctx, job, plan.changes, ranges).catch((e) => {
      job.state = 'failed';
      job.phase = 'finished';
      job.finishedAt = new Date().toISOString();
      this.logger.error(`calendar prices run ${job.id} crashed: ${e instanceof Error ? e.stack : String(e)}`);
    });
    return { ...job };
  }

  // ─── run ───────────────────────────────────────────────────────────────────

  private newJob(
    ctx: Ctx,
    input: Pick<CalendarDatesPlanInput, 'dateFrom' | 'dateToExclusive'> & { action: CalendarDatesJobAction },
    source: CalendarDatesJob['source'],
    plan: CalendarDatesPlan,
    ranges: ChangeRange[],
  ): CalendarDatesJob {
    const job: CalendarDatesJob = {
      id: randomUUID(),
      propertyId: ctx.property.id,
      source,
      action: input.action,
      dateFrom: input.dateFrom,
      dateToExclusive: input.dateToExclusive,
      state: 'running',
      phase: 'sending',
      total: ranges.length,
      sent: 0,
      failed: [],
      changes: countChanges(plan.changes),
      applied: null,
      verify: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    this.jobs.set(ctx.property.id, job);
    return job;
  }

  private async execute(
    ctx: Ctx,
    job: CalendarDatesJob,
    changes: NightChange[],
    ranges: ChangeRange[],
    alreadyClosed: string[] = [],
  ): Promise<void> {
    const sentRanges: ChangeRange[] = [];
    let failuresInRow = 0;
    for (const r of ranges) {
      try {
        await this.zodomus.setRates({
          channelId: ctx.target.channelId,
          propertyId: ctx.target.extProp,
          roomId: ctx.roomId,
          rateId: ctx.rateId,
          dateFrom: r.dateFrom,
          dateToExclusive: r.dateToExclusive,
          currencyCode: ctx.currency,
          price: r.price,
          closed: r.closed,
        });
        job.sent++;
        sentRanges.push(r);
        failuresInRow = 0;
      } catch (e) {
        const detail = formatZodomusHttpException(e);
        job.failed.push({ dateFrom: r.dateFrom, dateToExclusive: r.dateToExclusive, detail });
        this.logger.warn(
          `calendar dates ${job.action} property=${ctx.property.id} ${r.dateFrom}→${r.dateToExclusive} failed: ${detail}`,
        );
        failuresInRow++;
        if (failuresInRow >= MAX_FAILURES_IN_A_ROW) {
          job.state = 'stopped';
          break;
        }
      }
    }

    const inSent = (date: string) => sentRanges.some((r) => date >= r.dateFrom && date < r.dateToExclusive);
    const applied = changes.filter((c) => inSent(c.date));
    job.applied = countChanges(applied);
    this.dropWindowCache(ctx.property.id);
    if (applied.length > 0) {
      this.zodomusSync.invalidateCalendarOverlay(ctx.property.id);
      job.phase = 'verifying';
      const first = applied[0]!.date;
      const last = applied[applied.length - 1]!.date;
      try {
        const after = await this.readNights(ctx, first, addDaysYmd(last, 1), true);
        const mismatched = findMismatches(applied, after);
        job.verify = { checked: applied.length, mismatched };
      } catch (e) {
        job.verify = { checked: 0, mismatched: [], error: formatZodomusHttpException(e) };
      }
    }
    if (this.appliedListener && (applied.length > 0 || alreadyClosed.length > 0)) {
      try {
        await this.appliedListener(ctx.property.id, job.action, applied, alreadyClosed);
      } catch (e) {
        this.logger.warn(`calendar dates listener failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (job.state === 'running') job.state = job.sent === 0 && job.total > 0 ? 'failed' : 'done';
    job.phase = 'finished';
    job.finishedAt = new Date().toISOString();
    this.logger.log(
      `calendar dates ${job.source} ${job.action} property=${ctx.property.id} ${job.dateFrom}→${job.dateToExclusive}: ` +
        `${job.state}, sent ${job.sent}/${job.total}, mismatched ${job.verify?.mismatched.length ?? '—'}`,
    );
  }
}

