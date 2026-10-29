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
  operationsFingerprint,
  type AirbnbCalendarOperation,
  type BasicDeal,
  type BookingNightForAirbnb,
} from './airbnb-calendar.util';

/** Nights sent to Airbnb from today on (Booking availability goes 366 days ahead). */
const HORIZON_DAYS = 365;
/** Operations per POST /airbnb-calendar. */
const OPS_PER_CALL = 50;
/** A check older than this must be done again before connecting or sending. */
const PLAN_TTL_MS = 15 * 60_000;

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
  result: { activated: boolean; sentCalls: number; failedCalls: number; errors: string[] } | null;
}

interface StoredPlan {
  at: number;
  ops: AirbnbCalendarOperation[];
  noPriceNights: string[];
  summary: AirbnbPlanSummary;
}

/**
 * The pilot Airbnb listing: check what its calendar would be, connect it (POST /property-activation) and
 * send dates and prices (POST /airbnb-calendar) — only on the person's command, only the pilot listing, only
 * what the person checked (fingerprint). After it is connected every RentAI availability push also closes /
 * reopens its nights on Airbnb.
 */
@Injectable()
export class AirbnbCalendarService implements OnModuleInit {
  private readonly logger = new Logger(AirbnbCalendarService.name);
  private readonly jobs = new Map<string, AirbnbJob>();
  private readonly plans = new Map<string, StoredPlan>();

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

  private async owned(user: JwtPayload, propertyId: string) {
    return this.propertyService.findOneForUser(propertyId, user.sub, user.role);
  }

  private get pilotListingId(): string {
    return assertAirbnbPilotListing(AIRBNB_PILOT_LISTING_IDS[0]);
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
    const tz = property.timezone?.trim() || 'Europe/Warsaw';
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
    const ops = calendarOperations(nights);
    const forSale = nights.filter((n) => !n.occupied && n.price != null);
    const noPriceNights = nights.filter((n) => !n.occupied && n.price == null).map((n) => n.date);
    const prices = forSale.map((n) => n.price!);
    const listingId = this.pilotListingId;
    const summary: AirbnbPlanSummary = {
      listingId,
      from,
      toExclusive,
      nights: nights.length,
      forSale: forSale.length,
      occupied: nights.filter((n) => n.occupied).length,
      noPrice: noPriceNights.length,
      operations: ops.length,
      requests: Math.ceil(ops.length / OPS_PER_CALL),
      sample: ops.slice(0, 12),
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      fingerprint: operationsFingerprint(listingId, ops),
    };
    const plan: StoredPlan = { at: Date.now(), ops, noPriceNights, summary };
    this.plans.set(propertyId, plan);
    return plan;
  }

  /** Basic deals that are on Booking for the property (RentAI's and the extranet's own). */
  private async basicDeals(propertyId: string): Promise<BasicDeal[]> {
    const rows = await this.promotions.find({ where: { status: 'active', promotionType: 'basic' }, relations: ['targets'] });
    const out: BasicDeal[] = [];
    for (const p of rows) {
      if (!p.stayFrom || !p.stayTo) continue;
      const on = p.targets?.some((t) => t.propertyId === propertyId && t.desiredState === 'on' && t.state === 'on');
      if (!on) continue;
      out.push({ pct: Number(p.discountPct), from: p.stayFrom, to: p.stayTo, weekdays: p.activeWeekdays ?? null });
    }
    return out;
  }

  private checkedPlan(propertyId: string, fingerprint: string): StoredPlan {
    const plan = this.plans.get(propertyId);
    if (!plan || Date.now() - plan.at > PLAN_TTL_MS) {
      throw new ConflictException('Проверка устарела — нажмите «Проверить» ещё раз');
    }
    if (plan.summary.fingerprint !== fingerprint) {
      throw new ConflictException('Календарь изменился после проверки — нажмите «Проверить» ещё раз');
    }
    return plan;
  }

  // ─── connect / send ───────────────────────────────────────────────────────

  /**
   * «Подключить объявление»: POST /property-activation for the pilot listing, the Airbnb channel row for the
   * property (bookings from Airbnb find their property by it), then the checked calendar.
   */
  async startConnect(user: JwtPayload, propertyId: string, fingerprint: string): Promise<AirbnbJob> {
    this.assertOn();
    const property = await this.owned(user, propertyId);
    this.assertIdle(property.id);
    const listingId = this.pilotListingId;
    const plan = this.checkedPlan(property.id, fingerprint);
    const existing = await this.table(() => this.listings.findOne({ where: { listingId } }));
    if (existing && existing.propertyId !== property.id) {
      throw new ConflictException('Пилотное объявление Airbnb уже подключено к другому объекту');
    }
    if (existing?.activatedAt) throw new ConflictException('Объявление уже подключено — используйте «Отправить в Airbnb»');
    const token = await this.connect.activeHostToken(user);
    const platform = await this.platforms.findOne({ where: { code: 'airbnb' } });
    if (!platform || platform.zodomusChannelId !== AIRBNB_CHANNEL_ID) {
      throw new ServiceUnavailableException('Площадка airbnb (channel 3) не заведена в ota_platforms');
    }

    const job = this.newJob(property.id, 'connect');
    job.plan = plan.summary;
    void this.runJob(job, async () => {
      assertAirbnbPilotListing(listingId);
      await this.zodomus.upstreamPost('/property-activation', {
        channelId: AIRBNB_CHANNEL_ID,
        propertyId: listingId,
        priceModelId: 4,
        token,
      });
      await this.table(async () => {
        await this.listings.save(
          this.listings.create({ propertyId: property.id, listingId, activatedAt: new Date(), noPriceNights: plan.noPriceNights }),
        );
        const row = await this.channelRows.findOne({ where: { propertyId: property.id, otaPlatformId: platform.id } });
        if (!row) {
          await this.channelRows.save(
            this.channelRows.create({
              propertyId: property.id,
              otaPlatformId: platform.id,
              externalListingId: listingId,
              zodomusRoomId: `${listingId}01`,
              sortOrder: 1,
            }),
          );
        }
      });
      job.result = { activated: true, sentCalls: 0, failedCalls: 0, errors: [] };
      await this.sendOps(property.id, listingId, plan, job);
    });
    return job;
  }

  /** «Отправить в Airbnb» for a connected listing: the checked dates and prices again. */
  async startSend(user: JwtPayload, propertyId: string, fingerprint: string): Promise<AirbnbJob> {
    this.assertOn();
    const property = await this.owned(user, propertyId);
    this.assertIdle(property.id);
    const plan = this.checkedPlan(property.id, fingerprint);
    const row = await this.table(() => this.listings.findOne({ where: { propertyId: property.id } }));
    if (!row?.activatedAt) throw new BadRequestException('Объявление Airbnb ещё не подключено');
    const listingId = assertAirbnbPilotListing(row.listingId);
    const job = this.newJob(property.id, 'send');
    job.plan = plan.summary;
    job.result = { activated: false, sentCalls: 0, failedCalls: 0, errors: [] };
    void this.runJob(job, () => this.sendOps(property.id, listingId, plan, job));
    return job;
  }

  private async sendOps(propertyId: string, listingId: string, plan: StoredPlan, job: AirbnbJob): Promise<void> {
    const result = job.result!;
    for (const part of chunk(plan.ops, OPS_PER_CALL)) {
      try {
        await this.postCalendar(listingId, part);
        result.sentCalls++;
      } catch (e) {
        result.failedCalls++;
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    await this.table(() =>
      this.listings.update(
        { propertyId },
        {
          noPriceNights: plan.noPriceNights,
          lastSyncAt: new Date(),
          lastSync: { kind: 'full', operations: plan.ops.length, sentCalls: result.sentCalls, failedCalls: result.failedCalls, errors: result.errors.slice(0, 5) },
        },
      ),
    );
    if (result.failedCalls > 0) throw new Error(`Airbnb: не ушло ${result.failedCalls} из ${result.sentCalls + result.failedCalls} запросов`);
  }

  /** The one place that writes the Airbnb calendar: pilot listing only. */
  private async postCalendar(listingId: string, operations: AirbnbCalendarOperation[]): Promise<void> {
    const id = assertAirbnbPilotListing(listingId);
    const res = await this.zodomus.upstreamPost('/airbnb-calendar', { channelId: AIRBNB_CHANNEL_ID, propertyId: id, operations });
    // Zodomus answers `{ status, response: { success: true } }`; an explicit `false` is a refusal.
    const success = (res as { response?: { success?: unknown } } | null)?.response?.success;
    if (success === false) throw new Error('Airbnb не принял календарь (response.success=false)');
  }

  // ─── after every availability push ────────────────────────────────────────

  /** RentAI occupancy changed: close / reopen the nights on the connected pilot listing (no prices). */
  async afterAvailabilityPush(propertyId: string, days: { date: string; free: boolean }[]): Promise<void> {
    if (!this.connect.isEnabled || days.length === 0) return;
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
    const ops = availabilityOperations(days, new Set(row.noPriceNights ?? []));
    let sent = 0;
    const errors: string[] = [];
    for (const part of chunk(ops, OPS_PER_CALL)) {
      try {
        await this.postCalendar(listingId, part);
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
