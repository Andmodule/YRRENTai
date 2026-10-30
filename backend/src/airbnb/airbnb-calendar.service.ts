import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { PropertyService } from '../property/property.service';
import { PropertyChannelListingEntity } from '../property/entities/property-channel-listing.entity';
import type { PropertyEntity } from '../property/entities/property.entity';
import { OtaPlatformEntity } from '../property/entities/ota-platform.entity';
import { PricePromotionEntity } from '../pricing/entities/price-promotion.entity';
import { CalendarDatesService } from '../calendar-dates/calendar-dates.service';
import { ZodomusService } from '../integrations/zodomus/zodomus.service';
import { ZodomusRatesPushService } from '../integrations/zodomus/zodomus-rates-push.service';
import { ZodomusAvailabilityPushService } from '../integrations/zodomus/zodomus-availability-push.service';
import { AirbnbConnectService } from '../integrations/zodomus/airbnb/airbnb-connect.service';
import {
  AIRBNB_CHANNEL_ID,
  AIRBNB_PILOT_LISTING_IDS,
  assertAirbnbPilotListing,
} from '../integrations/zodomus/airbnb/airbnb-pilot.util';
import { todayInTz } from '../pricing/pricing-math.util';
import { ZodomusAirbnbListingEntity } from './airbnb-listing.entity';
import {
  addDaysYmd,
  airbnbNights,
  availabilityOperations,
  calendarOperations,
  chunk,
  closedTail,
  operationsFingerprint,
  type AirbnbCalendarOperation,
  type BasicDeal,
  type BookingNightForAirbnb,
} from './airbnb-calendar.util';

/** Nights sent to Airbnb from today on — the same as the Booking availability push (ZODOMUS_AVAILABILITY_HORIZON_DAYS). */
const HORIZON_DAYS = 366;
/** After the horizon, this many days are sent unavailable: RentAI does not guard them yet. */
const TAIL_DAYS = 365;
/** Operations per POST /airbnb-calendar. */
const OPS_PER_CALL = 50;
/** A check older than this must be done again before connecting or sending. */
const PLAN_TTL_MS = 15 * 60_000;
/** Zodomus asks for at most 1 Airbnb call per second (the limit is shared by all its clients). */
const MIN_GAP_MS = 1_500;
/** Waits before the 2nd and 3rd attempt of one POST /airbnb-calendar (Airbnb shuts the API for a minute on bursts). */
const RETRY_DELAYS_MS = [5_000, 65_000];

export interface AirbnbPlanSummary {
  listingId: string;
  from: string;
  toExclusive: string;
  nights: number;
  forSale: number;
  occupied: number;
  /** Free in RentAI but closed / without price on Booking: sent unavailable. */
  noPrice: number;
  operations: number;
  requests: number;
  /** First operations as they will be sent — for the person to look at. */
  sample: AirbnbCalendarOperation[];
  /** Lowest and highest Airbnb price among the nights for sale. */
  minPrice: number | null;
  maxPrice: number | null;
  fingerprint: string;
}

export interface AirbnbJob {
  propertyId: string;
  kind: 'check' | 'connect' | 'send';
  state: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  plan: AirbnbPlanSummary | null;
  /** connect / send: what went to Airbnb. */
  result: {
    activated: boolean;
    sentCalls: number;
    failedCalls: number;
    /** The calendar did not go through: the whole horizon was sent unavailable instead. */
    closedAll: boolean;
    errors: string[];
  } | null;
}

interface StoredPlan {
  at: number;
  ops: AirbnbCalendarOperation[];
  noPriceNights: string[];
  planEnd: string;
  summary: AirbnbPlanSummary;
}

type Sleep = (ms: number) => Promise<void>;

/**
 * The pilot Airbnb listing: check what its calendar would be, connect it (POST /property-activation) and
 * send dates and prices (POST /airbnb-calendar) — only on the person's command, only the pilot listing, only
 * what the person checked (the plan is built again right before sending and must not have changed). After
 * it is connected every RentAI availability push also closes / reopens its nights on Airbnb. Sends and
 * availability updates of one property never interleave (one chain per property).
 */
@Injectable()
export class AirbnbCalendarService implements OnModuleInit {
  private readonly logger = new Logger(AirbnbCalendarService.name);
  private readonly jobs = new Map<string, AirbnbJob>();
  private readonly plans = new Map<string, StoredPlan>();
  /** Per property: the tail of its chain of Airbnb work. */
  private readonly chains = new Map<string, Promise<void>>();
  /** Latest occupancy waiting to go to Airbnb, per property (older ones are dropped). */
  private readonly pendingDays = new Map<string, { date: string; free: boolean }[]>();
  private lastPostAt = 0;
  /** Replaced in tests. */
  sleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  constructor(
    private readonly connect: AirbnbConnectService,
    private readonly dates: CalendarDatesService,
    private readonly zodomus: ZodomusService,
    private readonly ratesPush: ZodomusRatesPushService,
    private readonly availabilityPush: ZodomusAvailabilityPushService,
    private readonly propertyService: PropertyService,
    @InjectRepository(ZodomusAirbnbListingEntity) private readonly listings: Repository<ZodomusAirbnbListingEntity>,
    @InjectRepository(PropertyChannelListingEntity) private readonly channelRows: Repository<PropertyChannelListingEntity>,
    @InjectRepository(OtaPlatformEntity) private readonly platforms: Repository<OtaPlatformEntity>,
    @InjectRepository(PricePromotionEntity) private readonly promotions: Repository<PricePromotionEntity>,
  ) {}

  onModuleInit(): void {
    this.availabilityPush.setAfterPushListener((propertyId, days) => this.afterAvailabilityPush(propertyId, days));
  }

  private assertOn(): void {
    if (!this.connect.isEnabled) {
      throw new ServiceUnavailableException('Airbnb выключен (ZODOMUS_AIRBNB_ENABLED=false)');
    }
  }

  private async table<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      if (e instanceof QueryFailedError && (e as { driverError?: { code?: string } }).driverError?.code === '42P01') {
        throw new ServiceUnavailableException(
          'Таблицы Airbnb не созданы: запустите миграцию 1778900000000-zodomus-airbnb-hosts',
        );
      }
      throw e;
    }
  }

  private async owned(user: JwtPayload, propertyId: string): Promise<PropertyEntity> {
    return this.propertyService.findOneForUser(propertyId, user.sub, user.role);
  }

  private get pilotListingId(): string {
    return assertAirbnbPilotListing(AIRBNB_PILOT_LISTING_IDS[0]);
  }

  /** Runs `work` after everything already queued for the property (sends and availability updates). */
  private locked<T>(propertyId: string, work: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(propertyId) ?? Promise.resolve();
    const run = prev.then(work, work);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.chains.set(propertyId, tail);
    void tail.then(() => {
      if (this.chains.get(propertyId) === tail) this.chains.delete(propertyId);
    });
    return run;
  }

  // ─── read ─────────────────────────────────────────────────────────────────

  async view(user: JwtPayload, propertyId: string) {
    this.assertOn();
    const property = await this.owned(user, propertyId);
    const row = await this.table(() => this.listings.findOne({ where: { propertyId: property.id } }));
    const taken = row ? null : await this.table(() => this.listings.findOne({ where: { listingId: this.pilotListingId } }));
    return {
      listingId: this.pilotListingId,
      connected: row?.activatedAt != null,
      activatedAt: row?.activatedAt?.toISOString() ?? null,
      planEnd: row?.planEnd ?? null,
      lastSyncAt: row?.lastSyncAt?.toISOString() ?? null,
      lastSync: row?.lastSync ?? null,
      /** The pilot listing is connected to another property. */
      takenByOther: taken != null && taken.propertyId !== property.id,
      job: this.jobs.get(property.id) ?? null,
    };
  }

  job(propertyId: string): AirbnbJob | null {
    return this.jobs.get(propertyId) ?? null;
  }

  // ─── plan ─────────────────────────────────────────────────────────────────

  /** Starts «Проверить»: reads Booking for a year (≈ 14 calls) — answers at once, the job is polled. */
  async startCheck(user: JwtPayload, propertyId: string): Promise<AirbnbJob> {
    this.assertOn();
    const property = await this.owned(user, propertyId);
    this.assertIdle(property.id);
    const job = this.newJob(property.id, 'check');
    void this.runJob(job, async () => {
      job.plan = (await this.buildPlan(property)).summary;
    });
    return job;
  }

  private async buildPlan(property: PropertyEntity): Promise<StoredPlan> {
    const propertyId = property.id;
    const tz = property.timezone?.trim() || 'UTC';
    const from = todayInTz(tz);
    const toExclusive = addDaysYmd(from, HORIZON_DAYS);
    const dates: string[] = [];
    for (let d = from; d < toExclusive; d = addDaysYmd(d, 1)) dates.push(d);

    const [rateNights, occupied, deals, minPrice] = await Promise.all([
      this.dates.bookingRateNights(propertyId, from, toExclusive),
      this.ratesPush.collectCrmBlockedNightKeys(property, from, toExclusive),
      this.basicDeals(propertyId),
      this.dates.minPriceOf(propertyId),
    ]);
    const booking = new Map<string, BookingNightForAirbnb>();
    for (const [date, n] of rateNights) {
      booking.set(date, { date, rack: n.price, closed: n.closed || n.availability === 0 });
    }
    // A night sold on Booking (booked > 0) is occupied even before RentAI has the booking.
    const occ = new Set(occupied);
    for (const [date, n] of rateNights) if (n.booked > 0) occ.add(date);

    const nights = airbnbNights(booking, dates, deals, occ, minPrice);
    const ops = [...calendarOperations(nights), closedTail(toExclusive, TAIL_DAYS)];
    const forSale = nights.filter((n) => !n.occupied && n.price != null);
    const noPriceNights = nights.filter((n) => n.price == null).map((n) => n.date);
    const prices = forSale.map((n) => n.price!);
    const listingId = this.pilotListingId;
    const summary: AirbnbPlanSummary = {
      listingId,
      from,
      toExclusive,
      nights: nights.length,
      forSale: forSale.length,
      occupied: nights.filter((n) => n.occupied).length,
      noPrice: nights.filter((n) => !n.occupied && n.price == null).length,
      operations: ops.length,
      requests: Math.ceil(ops.length / OPS_PER_CALL),
      sample: ops.slice(0, 12),
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      fingerprint: operationsFingerprint(listingId, ops),
    };
    const plan: StoredPlan = { at: Date.now(), ops, noPriceNights, planEnd: toExclusive, summary };
    this.plans.set(propertyId, plan);
    return plan;
  }

  /**
   * Basic deals on Booking for the property (RentAI's and the extranet's own) that a regular guest gets:
   * on the property's target, and not limited to mobile / members (`targetChannel` other than public).
   */
  private async basicDeals(propertyId: string): Promise<BasicDeal[]> {
    const rows = await this.promotions.find({ where: { status: 'active', promotionType: 'basic' }, relations: ['targets'] });
    const out: BasicDeal[] = [];
    for (const p of rows) {
      if (!p.stayFrom || !p.stayTo) continue;
      const target = (p.externalMeta as { targetChannel?: unknown } | null)?.targetChannel;
      if (target != null && String(target).toLowerCase() !== 'public') continue;
      const on = p.targets?.some((t) => t.propertyId === propertyId && t.desiredState === 'on' && t.state === 'on');
      if (!on) continue;
      out.push({ pct: Number(p.discountPct), from: p.stayFrom, to: p.stayTo, weekdays: p.activeWeekdays ?? null });
    }
    return out;
  }

  /** The checked plan must be fresh; then it is built again from Booking and RentAI and must be the same. */
  private async recheckedPlan(property: PropertyEntity, fingerprint: string, job: AirbnbJob): Promise<StoredPlan> {
    const plan = this.plans.get(property.id);
    if (!plan || Date.now() - plan.at > PLAN_TTL_MS) {
      throw new ConflictException('Проверка устарела — нажмите «Проверить» ещё раз');
    }
    if (plan.summary.fingerprint !== fingerprint) {
      throw new ConflictException('Календарь изменился после проверки — нажмите «Проверить» ещё раз');
    }
    const fresh = await this.buildPlan(property);
    // The job shows the new calendar: the person looks at it and connects / sends that one.
    job.plan = fresh.summary;
    if (fresh.summary.fingerprint !== fingerprint) {
      throw new ConflictException(
        'Пока вы смотрели проверку, на Booking или в RentAI что-то изменилось — проверьте новый календарь и нажмите ещё раз',
      );
    }
    return fresh;
  }

  // ─── connect / send ───────────────────────────────────────────────────────

  /**
   * «Подключить объявление»: checks first (no other listing on this property, no iCal from Airbnb, the
   * pilot not used elsewhere, the host active), then — under the property's chain — the plan again,
   * POST /property-activation, the checked calendar, and the Airbnb channel row (bookings from Airbnb find
   * their property by it).
   */
  async startConnect(user: JwtPayload, propertyId: string, fingerprint: string): Promise<AirbnbJob> {
    this.assertOn();
    const property = await this.owned(user, propertyId);
    this.assertIdle(property.id);
    const listingId = this.pilotListingId;
    const checked = this.plans.get(property.id);
    if (!checked || Date.now() - checked.at > PLAN_TTL_MS || checked.summary.fingerprint !== fingerprint) {
      throw new ConflictException('Нет свежей проверки с этим календарём — нажмите «Проверить» ещё раз');
    }
    const existing = await this.table(() => this.listings.findOne({ where: { listingId } }));
    if (existing && existing.propertyId !== property.id) {
      throw new ConflictException('Пилотное объявление Airbnb уже подключено к другому объекту');
    }
    if (existing?.activatedAt) throw new ConflictException('Объявление уже подключено — используйте «Отправить в Airbnb»');
    if ((property.icalImportUrls ?? []).some((u) => /airbnb\./i.test(String(u)))) {
      throw new BadRequestException(
        'У объекта есть импорт iCal из Airbnb — уберите его до подключения: иначе брони задвоятся, а закрытые ночи станут бронями',
      );
    }
    const platform = await this.platforms.findOne({ where: { code: 'airbnb' } });
    if (!platform || platform.zodomusChannelId !== AIRBNB_CHANNEL_ID) {
      throw new ServiceUnavailableException('Площадка airbnb (channel 3) не заведена в ota_platforms');
    }
    const ownRow = await this.channelRows.findOne({ where: { propertyId: property.id, otaPlatformId: platform.id } });
    if (ownRow && ownRow.externalListingId?.trim() !== listingId) {
      throw new ConflictException(`У объекта уже привязано другое объявление Airbnb (${ownRow.externalListingId}) — уберите его`);
    }
    const elsewhere = await this.channelRows.findOne({ where: { externalListingId: listingId } });
    if (elsewhere && elsewhere.propertyId !== property.id) {
      throw new ConflictException('Пилотное объявление Airbnb привязано к другому объекту в карточке объекта');
    }
    const token = await this.connect.activeHostToken(user);

    const job = this.newJob(property.id, 'connect');
    job.plan = checked.summary;
    void this.runJob(job, () =>
      this.locked(property.id, async () => {
        const plan = await this.recheckedPlan(property, fingerprint, job);
        assertAirbnbPilotListing(listingId);
        await this.zodomus.upstreamPost('/property-activation', {
          channelId: AIRBNB_CHANNEL_ID,
          propertyId: listingId,
          priceModelId: 4,
          token,
        });
        job.result = { activated: true, sentCalls: 0, failedCalls: 0, closedAll: false, errors: [] };
        // From here on availability pushes reach the listing (they wait for this chain).
        await this.table(() =>
          this.listings.save(
            this.listings.create({ propertyId: property.id, listingId, activatedAt: new Date(), noPriceNights: plan.noPriceNights, planEnd: null }),
          ),
        );
        // The channel row right away: an Airbnb booking arriving during the calendar send finds its property.
        let rowError: string | null = null;
        if (!ownRow) {
          try {
            await this.channelRows.save(
              this.channelRows.create({
                propertyId: property.id,
                otaPlatformId: platform.id,
                externalListingId: listingId,
                zodomusRoomId: `${listingId}01`,
                sortOrder: 1,
              }),
            );
          } catch (e) {
            rowError = `Строка Airbnb в карточке объекта не сохранилась — брони Airbnb не найдут объект: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
        const calendarError = await this.sendPlan(property.id, listingId, plan, job);
        const problems = [calendarError, rowError].filter(Boolean);
        if (problems.length > 0) throw new Error(problems.join(' · '));
      }),
    );
    return job;
  }

  /** «Отправить в Airbnb» for a connected listing: the checked dates and prices again. */
  async startSend(user: JwtPayload, propertyId: string, fingerprint: string): Promise<AirbnbJob> {
    this.assertOn();
    const property = await this.owned(user, propertyId);
    this.assertIdle(property.id);
    const checked = this.plans.get(property.id);
    if (!checked || Date.now() - checked.at > PLAN_TTL_MS || checked.summary.fingerprint !== fingerprint) {
      throw new ConflictException('Нет свежей проверки с этим календарём — нажмите «Проверить» ещё раз');
    }
    const row = await this.table(() => this.listings.findOne({ where: { propertyId: property.id } }));
    if (!row?.activatedAt) throw new BadRequestException('Объявление Airbnb ещё не подключено');
    const listingId = assertAirbnbPilotListing(row.listingId);
    const job = this.newJob(property.id, 'send');
    job.plan = checked.summary;
    job.result = { activated: false, sentCalls: 0, failedCalls: 0, closedAll: false, errors: [] };
    void this.runJob(job, () =>
      this.locked(property.id, async () => {
        const plan = await this.recheckedPlan(property, fingerprint, job);
        const err = await this.sendPlan(property.id, listingId, plan, job);
        if (err) throw new Error(err);
      }),
    );
    return job;
  }

  /**
   * The plan, chunk by chunk, each with retries. If a chunk still fails, the whole horizon (and the tail)
   * is sent unavailable instead — an open night RentAI does not guard could be sold twice. Returns the error
   * to report, or null.
   */
  private async sendPlan(propertyId: string, listingId: string, plan: StoredPlan, job: AirbnbJob): Promise<string | null> {
    const result = job.result!;
    let failed = false;
    for (const part of chunk(plan.ops, OPS_PER_CALL)) {
      try {
        await this.postCalendarWithRetry(listingId, part);
        result.sentCalls++;
      } catch (e) {
        result.failedCalls++;
        result.errors.push(e instanceof Error ? e.message : String(e));
        failed = true;
        break;
      }
    }
    if (failed) {
      try {
        await this.postCalendarWithRetry(listingId, [closedTail(plan.summary.from, HORIZON_DAYS + TAIL_DAYS)]);
        result.closedAll = true;
      } catch (e) {
        result.errors.push(`закрыть всё тоже не вышло: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await this.table(() =>
      this.listings.update(
        { propertyId },
        {
          noPriceNights: failed ? [] : plan.noPriceNights,
          // Closed all: nothing reopens until a send goes through.
          planEnd: failed ? plan.summary.from : plan.planEnd,
          lastSyncAt: new Date(),
          lastSync: {
            kind: 'full',
            operations: plan.ops.length,
            sentCalls: result.sentCalls,
            failedCalls: result.failedCalls,
            closedAll: result.closedAll,
            errors: result.errors.slice(0, 5),
          },
        },
      ),
    );
    if (!failed) return null;
    return result.closedAll
      ? `Календарь Airbnb не ушёл (${result.errors[0]}) — объявление закрыто на Airbnb целиком; нажмите «Проверить» и «Отправить в Airbnb»`
      : `Календарь Airbnb не ушёл и закрыть объявление не удалось (${result.errors.join(' · ')}) — закройте даты на Airbnb вручную`;
  }

  private async postCalendarWithRetry(listingId: string, operations: AirbnbCalendarOperation[]): Promise<void> {
    let last: unknown = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) await this.sleep(RETRY_DELAYS_MS[attempt - 1]!);
      try {
        await this.postCalendar(listingId, operations);
        return;
      } catch (e) {
        if (e instanceof ForbiddenException) throw e;
        last = e;
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  /** The one place that writes the Airbnb calendar: pilot listing only, at most one call per MIN_GAP_MS. */
  private async postCalendar(listingId: string, operations: AirbnbCalendarOperation[]): Promise<void> {
    const id = assertAirbnbPilotListing(listingId);
    const wait = this.lastPostAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.lastPostAt = Date.now();
    const res = await this.zodomus.upstreamPost('/airbnb-calendar', { channelId: AIRBNB_CHANNEL_ID, propertyId: id, operations });
    // Zodomus answers `{ status, response: { success: true } }`; an explicit `false` is a refusal.
    const success = (res as { response?: { success?: unknown } } | null)?.response?.success;
    if (success === false) throw new Error('Airbnb не принял календарь (response.success=false)');
  }

  // ─── after every availability push ────────────────────────────────────────

  /**
   * RentAI occupancy changed: close / reopen the nights on the connected pilot listing (no prices). Called
   * by the Booking push without waiting: only the latest occupancy of a property is kept, and it goes out
   * after whatever Airbnb work of that property is running.
   */
  afterAvailabilityPush(propertyId: string, days: { date: string; free: boolean }[]): Promise<void> {
    if (!this.connect.isEnabled || days.length === 0) return Promise.resolve();
    const queued = this.pendingDays.has(propertyId);
    this.pendingDays.set(propertyId, days);
    if (queued) return Promise.resolve();
    return this.locked(propertyId, async () => {
      const latest = this.pendingDays.get(propertyId);
      this.pendingDays.delete(propertyId);
      if (latest) await this.sendAvailability(propertyId, latest);
    }).catch((e) => {
      this.logger.warn(`Airbnb availability for ${propertyId} failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  private async sendAvailability(propertyId: string, days: { date: string; free: boolean }[]): Promise<void> {
    let row: ZodomusAirbnbListingEntity | null;
    try {
      row = await this.listings.findOne({ where: { propertyId } });
    } catch {
      return; // tables not migrated: nothing is connected
    }
    if (!row?.activatedAt) return;
    let listingId: string;
    try {
      listingId = assertAirbnbPilotListing(row.listingId);
    } catch (e) {
      if (e instanceof ForbiddenException) return;
      throw e;
    }
    const ops = availabilityOperations(days, new Set(row.noPriceNights ?? []), row.planEnd ?? null);
    let sent = 0;
    const errors: string[] = [];
    for (const part of chunk(ops, OPS_PER_CALL)) {
      try {
        await this.postCalendarWithRetry(listingId, part);
        sent++;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    await this.listings.update(
      { propertyId },
      { lastSyncAt: new Date(), lastSync: { kind: 'availability', operations: ops.length, sentCalls: sent, failedCalls: errors.length, errors: errors.slice(0, 5) } },
    );
    if (errors.length > 0) this.logger.warn(`Airbnb availability for ${propertyId}: ${errors.length} call(s) failed — ${errors[0]}`);
  }

  // ─── jobs ─────────────────────────────────────────────────────────────────

  private assertIdle(propertyId: string): void {
    if (this.jobs.get(propertyId)?.state === 'running') {
      throw new ConflictException('Для этого объекта уже идёт проверка или отправка в Airbnb');
    }
  }

  private newJob(propertyId: string, kind: AirbnbJob['kind']): AirbnbJob {
    const job: AirbnbJob = {
      propertyId,
      kind,
      state: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      plan: null,
      result: null,
    };
    this.jobs.set(propertyId, job);
    return job;
  }

  private async runJob(job: AirbnbJob, work: () => Promise<void>): Promise<void> {
    try {
      await work();
      job.state = 'done';
    } catch (e) {
      job.state = 'failed';
      job.error = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Airbnb ${job.kind} for ${job.propertyId} failed: ${job.error}`);
    } finally {
      job.finishedAt = new Date().toISOString();
    }
  }
}
