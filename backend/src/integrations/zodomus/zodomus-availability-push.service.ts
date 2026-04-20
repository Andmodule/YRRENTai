import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { addDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { Queue, Worker } from 'bullmq';
import { BOOKING_STATUS } from '@rentai/shared';
import { BookingEntity } from '../../booking/entities/booking.entity';
import { PropertyEntity } from '../../property/entities/property.entity';
import { ZodomusService } from './zodomus.service';

/** Statuses that do not block inventory on OTAs. */
const NON_BLOCKING = new Set<string>([BOOKING_STATUS.CANCELLED, BOOKING_STATUS.DECLINED]);

export type PushAvailabilityOptions = {
  /** When true, push even if ZODOMUS_AUTO_PUSH_AVAILABILITY is false (manual, dirty retry, nightly). */
  ignoreAutoPushDisable?: boolean;
  /** Limit the sync to a specific date range (Delta Sync). */
  dateFromISO?: string;
  /** Limit the sync to a specific date range (Delta Sync). */
  dateToISO?: string;
};

type AvailabilitySegment = {
  channelId: number;
  extProp: string;
  roomId: string;
  dateFrom: string;
  dateToExclusive: string;
  availability: number;
  propertyId: string;
};

/** Permanent Zodomus errors that mean the property configuration is wrong — don't keep retrying. */
const AVAIL_PERMANENT_MSGS = ['invalid property id', 'property status not active'];
function isAvailPermanentError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  return AVAIL_PERMANENT_MSGS.some((m) => msg.includes(m));
}

@Injectable()
export class ZodomusAvailabilityPushService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ZodomusAvailabilityPushService.name);
  private queue: Queue<AvailabilitySegment> | null = null;
  private worker: Worker<AvailabilitySegment> | null = null;

  /** Circuit breaker for availability push: tracks consecutive failures per property. */
  private readonly _availFailCount = new Map<string, number>();
  private readonly _availFailSince = new Map<string, number>();
  private static readonly AVAIL_CIRCUIT_AFTER = 3;
  private static readonly AVAIL_RESET_MS = 15 * 60 * 1000;

  private isAvailCircuitOpen(propertyId: string): boolean {
    const count = this._availFailCount.get(propertyId) ?? 0;
    if (count < ZodomusAvailabilityPushService.AVAIL_CIRCUIT_AFTER) return false;
    const since = this._availFailSince.get(propertyId) ?? 0;
    if (Date.now() - since > ZodomusAvailabilityPushService.AVAIL_RESET_MS) {
      this._availFailCount.delete(propertyId);
      this._availFailSince.delete(propertyId);
      return false;
    }
    return true;
  }

  private recordAvailFailure(propertyId: string, permanent: boolean): void {
    const count = (this._availFailCount.get(propertyId) ?? 0) + 1;
    this._availFailCount.set(propertyId, count);
    if (count === 1) this._availFailSince.set(propertyId, Date.now());
    if (permanent && count >= ZodomusAvailabilityPushService.AVAIL_CIRCUIT_AFTER) {
      this.logger.warn(
        `Availability push circuit OPEN for ${propertyId} — permanent Zodomus error. Fix externalListingId or activate property in Zodomus.`,
      );
    }
  }

  private recordAvailSuccess(propertyId: string): void {
    this._availFailCount.delete(propertyId);
    this._availFailSince.delete(propertyId);
  }

  constructor(
    private readonly zodomus: ZodomusService,
    private readonly config: ConfigService,
    @InjectRepository(BookingEntity)
    private readonly bookingRepo: Repository<BookingEntity>,
    @InjectRepository(PropertyEntity)
    private readonly propertyRepo: Repository<PropertyEntity>,
  ) {}

  get redisUrl(): string | undefined {
    return this.config.get<string>('REDIS_URL')?.trim() || undefined;
  }

  async onModuleInit(): Promise<void> {
    const url = this.redisUrl;
    if (!url) {
      this.logger.warn('REDIS_URL not set — Zodomus availability push will run synchronously (NOT RECOMMENDED).');
      return;
    }

    const connection = { url };
    
    this.queue = new Queue<AvailabilitySegment>('zodomus-availability', { connection });

    this.worker = new Worker<AvailabilitySegment>(
      'zodomus-availability',
      async (job) => {
        const { channelId, extProp, roomId, dateFrom, dateToExclusive, availability } = job.data;
        await this.zodomus.setAvailability(channelId, extProp, roomId, dateFrom, dateToExclusive, availability);
      },
      {
        connection,
        concurrency: 1,
        limiter: {
          max: 60, // 60 requests per 60 seconds (Zodomus rate limit)
          duration: 60_000,
        },
      }
    );

    // When a segment job completes successfully, clear the dirty flag — the property is in sync.
    // Note: this fires for every segment (potentially many per property); clearDirty is idempotent.
    this.worker.on('completed', async (job) => {
      if (job?.data.propertyId) {
        await this.clearDirty(job.data.propertyId);
      }
    });

    this.worker.on('failed', async (job, err) => {
      this.logger.error(
        `Zodomus availability push failed for ${job?.data.propertyId} (${job?.data.dateFrom}–${job?.data.dateToExclusive}): ${(err as Error).message}`,
      );
      if (job?.data.propertyId) {
        await this.markDirty(job.data.propertyId);
      }
    });

    this.logger.log('Zodomus availability BullMQ queue initialized (rate limited to 60 req/min).');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /**
   * Pushes availability changes. Now accepts optional date ranges for delta sync.
   */
  scheduleAvailabilityPush(propertyId: string, options?: PushAvailabilityOptions): void {
    const run = () => {
      void this.pushAvailabilityNow(propertyId, options).catch((e) =>
        this.logger.warn(`Zodomus availability push failed for ${propertyId}: ${String(e)}`),
      );
    };
    
    // We can run immediately because execution just enqueues segments into BullMQ.
    run();
  }

  /**
   * Computes segments and enqueues them.
   */
  async pushAvailabilityNow(propertyId: string, options?: PushAvailabilityOptions): Promise<void> {
    try {
      const didEnqueue = await this.executePush(propertyId, options);
      if (didEnqueue && !this.queue) {
        // If inline executed successfully, clear dirty flag.
        await this.clearDirty(propertyId);
      }
    } catch (e) {
      if (!(e instanceof ServiceUnavailableException)) {
        await this.markDirty(propertyId);
      }
      throw e;
    }
  }

  /** Cron: retry all properties flagged after a failed push. */
  async retryDirtyProperties(): Promise<void> {
    if (!this.zodomus.isEnabled) return;
    const rows = await this.propertyRepo
      .createQueryBuilder('p')
      .select('p.id')
      .where('p.zodomusAvailabilityDirty = true')
      .andWhere(
        new Brackets((qb) =>
          qb.where('p.zodomusPropertyId IS NOT NULL').orWhere(
            'EXISTS (SELECT 1 FROM property_channel_listings pcl WHERE pcl."propertyId" = p.id)',
          ),
        ),
      )
      .getMany();
    if (rows.length === 0) return;
    this.logger.log(`Zodomus availability dirty retry: ${rows.length} property(ies)`);
    for (const p of rows) {
      if (this.isAvailCircuitOpen(p.id)) continue;
      try {
        await this.pushAvailabilityNow(p.id, { ignoreAutoPushDisable: true });
        this.recordAvailSuccess(p.id);
        // When BullMQ is active the dirty flag is cleared in the worker's 'completed' handler.
        // When running inline (no Redis) clearDirty happens inside pushAvailabilityNow already.
      } catch (e) {
        const permanent = isAvailPermanentError(e);
        this.recordAvailFailure(p.id, permanent);
        const failCount = this._availFailCount.get(p.id) ?? 0;
        if (failCount < ZodomusAvailabilityPushService.AVAIL_CIRCUIT_AFTER) {
          this.logger.warn(`Dirty retry failed for ${p.id}: ${String(e)}`);
        }
      }
    }
  }

  /** Nightly drift guard: enqueue full push for every property, staggered via queue. */
  async nightlyReconcileAll(): Promise<void> {
    const enabled = this.config.get<boolean>('ZODOMUS_AVAILABILITY_NIGHTLY_FULL_PUSH') ?? true;
    if (!enabled || !this.zodomus.isEnabled) return;
    const rows = await this.propertyRepo
      .createQueryBuilder('p')
      .select('p.id')
      .where(
        new Brackets((qb) =>
          qb.where('p.zodomusPropertyId IS NOT NULL').orWhere(
            'EXISTS (SELECT 1 FROM property_channel_listings pcl WHERE pcl."propertyId" = p.id)',
          ),
        ),
      )
      .getMany();
    if (rows.length === 0) return;
    this.logger.log(`Zodomus nightly availability reconcile enqueuing: ${rows.length} property(ies)`);
    
    // Spread execution over several minutes to avoid hammering the DB all at once.
    // Uses ZODOMUS_AVAILABILITY_BATCH_GAP_MS (default 1000 ms between properties).
    const gapMs = Math.max(500, this.config.get<number>('ZODOMUS_AVAILABILITY_BATCH_GAP_MS') ?? 1000);
    let delayMs = 0;
    for (const p of rows) {
      setTimeout(() => {
        void this.pushAvailabilityNow(p.id, { ignoreAutoPushDisable: true }).catch((e) =>
          this.logger.warn(`Nightly reconcile failed for ${p.id}: ${String(e)}`),
        );
      }, delayMs);
      delayMs += gapMs;
    }
  }

  /** @returns true if at least one segment was sent/enqueued to Zodomus. */
  private async executePush(propertyId: string, options?: PushAvailabilityOptions): Promise<boolean> {
    const auto = this.config.get<boolean>('ZODOMUS_AUTO_PUSH_AVAILABILITY') ?? true;
    if (!auto && !options?.ignoreAutoPushDisable) return false;
    if (!this.zodomus.isEnabled) {
      throw new ServiceUnavailableException('Zodomus integration is disabled');
    }

    const property = await this.propertyRepo.findOne({
      where: { id: propertyId },
      relations: ['otaPlatform', 'channelListings', 'channelListings.otaPlatform'],
    });
    if (!property) return false;

    type PushTarget = { channelId: number; extProp: string; storedRoomId: string | null };
    const targets: PushTarget[] = [];
    for (const row of property.channelListings ?? []) {
      const ch = row.otaPlatform?.zodomusChannelId;
      const ext = row.externalListingId?.trim();
      if (ch == null || !ext) continue;
      targets.push({
        channelId: ch,
        extProp: ext,
        storedRoomId: row.zodomusRoomId?.trim() ? row.zodomusRoomId.trim() : null,
      });
    }
    if (targets.length === 0) {
      const leg = property.zodomusPropertyId?.trim();
      const ch =
        property.otaPlatform?.zodomusChannelId ??
        this.config.get<number>('ZODOMUS_DEFAULT_CHANNEL_ID') ??
        1;
      if (leg) {
        targets.push({
          channelId: ch,
          extProp: leg,
          storedRoomId: property.zodomusRoomId?.trim() ? property.zodomusRoomId.trim() : null,
        });
      }
    }
    if (targets.length === 0) return false;

    const tz = property.timezone?.trim() || 'UTC';
    const now = new Date();
    const todayKey = formatInTimeZone(now, tz, 'yyyy-MM-dd');

    // DELTA SYNC LOGIC
    // If dateFromISO/dateToISO are provided, only evaluate that range instead of full 365 days.
    let startEvalDate = fromZonedTime(`${todayKey}T12:00:00`, tz);
    let endEvalDate = addDays(startEvalDate, Math.min(730, Math.max(1, this.config.get<number>('ZODOMUS_AVAILABILITY_HORIZON_DAYS') ?? 366)));

    if (options?.dateFromISO) {
       const df = new Date(options.dateFromISO);
       if (df > startEvalDate) startEvalDate = df;
    }
    if (options?.dateToISO) {
       const dt = new Date(options.dateToISO);
       if (dt < endEvalDate) endEvalDate = dt;
    }
    
    // Safety check - never evaluate past the horizon
    const maxHorizon = addDays(fromZonedTime(`${todayKey}T12:00:00`, tz), 730);
    if (endEvalDate > maxHorizon) endEvalDate = maxHorizon;

    const daysCount = Math.ceil((endEvalDate.getTime() - startEvalDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysCount <= 0) return false;

    const bookings = await this.bookingRepo.find({ where: { propertyId } });
    const blocking = bookings.filter((b) => !NON_BLOCKING.has(String(b.status)));

    const days: { key: string; availability: number }[] = [];
    for (let i = 0; i < daysCount; i++) {
      const d = addDays(startEvalDate, i);
      const nightKey = formatInTimeZone(d, tz, 'yyyy-MM-dd');
      const occupied = blocking.some((b) => this.nightOverlapsBooking(nightKey, b, tz));
      days.push({ key: nightKey, availability: occupied ? 0 : 1 });
    }

    const segments = this.mergeSegments(days, tz);

    let anyPushed = false;
    for (const t of targets) {
      const roomId = await this.resolveRoomIdForTarget(property, t);
      if (!roomId) {
        this.logger.warn(
          `Zodomus availability: no room id for property ${propertyId} channel ${t.channelId} — set room id on the channel row or ensure GET /room-rates returns rooms`,
        );
        continue;
      }
      
      for (const seg of segments) {
        const payload: AvailabilitySegment = {
            channelId: t.channelId,
            extProp: t.extProp,
            roomId,
            dateFrom: seg.dateFrom,
            dateToExclusive: seg.dateToExclusive,
            availability: seg.availability,
            propertyId
        };
        
        if (this.queue) {
            // Deduplicate same segment updates in queue
            const jobId = `zodomus-avail-${propertyId}-${t.channelId}-${roomId}-${seg.dateFrom}`;
            await this.queue.add('push-segment', payload, {
               jobId,
               attempts: 5,
               backoff: { type: 'exponential', delay: 60000 },
               removeOnComplete: true,
               removeOnFail: { age: 86400 }
            });
        } else {
            // Fallback inline execution
            await this.zodomus.setAvailability(
              t.channelId,
              t.extProp,
              roomId,
              seg.dateFrom,
              seg.dateToExclusive,
              seg.availability,
            );
        }
      }
      anyPushed = true;
      this.logger.log(
        `Zodomus availability: property ${propertyId} channel ${t.channelId} — ${segments.length} segment(s) enqueued/pushed.`,
      );
    }
    return anyPushed;
  }

  private async markDirty(propertyId: string): Promise<void> {
    await this.propertyRepo
      .createQueryBuilder()
      .update(PropertyEntity)
      .set({ zodomusAvailabilityDirty: true })
      .where('id = :propertyId', { propertyId })
      .andWhere(
        '(zodomusPropertyId IS NOT NULL OR EXISTS (SELECT 1 FROM property_channel_listings pcl WHERE pcl."propertyId" = :propertyId))',
        { propertyId },
      )
      .execute();
  }

  private async clearDirty(propertyId: string): Promise<void> {
    await this.propertyRepo
      .createQueryBuilder()
      .update(PropertyEntity)
      .set({ zodomusAvailabilityDirty: false })
      .where('id = :propertyId', { propertyId })
      .andWhere(
        '(zodomusPropertyId IS NOT NULL OR EXISTS (SELECT 1 FROM property_channel_listings pcl WHERE pcl."propertyId" = :propertyId))',
        { propertyId },
      )
      .execute();
  }

  private nightOverlapsBooking(nightKey: string, b: BookingEntity, tz: string): boolean {
    const ci = formatInTimeZone(b.checkIn, tz, 'yyyy-MM-dd');
    const co = formatInTimeZone(b.checkOut, tz, 'yyyy-MM-dd');
    return ci <= nightKey && nightKey < co;
  }

  private mergeSegments(
    days: { key: string; availability: number }[],
    tz: string,
  ): Array<{ dateFrom: string; dateToExclusive: string; availability: number }> {
    if (days.length === 0) return [];
    const first = days[0];
    if (!first) return [];
    const out: Array<{ dateFrom: string; dateToExclusive: string; availability: number }> = [];
    let segStart = first.key;
    let segAvail = first.availability;
    for (let i = 1; i < days.length; i++) {
      const d = days[i];
      const prev = days[i - 1];
      if (!d || !prev) continue;
      if (d.availability === segAvail) continue;
      out.push({
        dateFrom: segStart,
        dateToExclusive: this.dayAfterInTz(prev.key, tz),
        availability: segAvail,
      });
      segStart = d.key;
      segAvail = d.availability;
    }
    const last = days[days.length - 1];
    if (last) {
      out.push({
        dateFrom: segStart,
        dateToExclusive: this.dayAfterInTz(last.key, tz),
        availability: segAvail,
      });
    }
    return out;
  }

  private dayAfterInTz(nightKey: string, tz: string): string {
    const d = addDays(fromZonedTime(`${nightKey}T12:00:00`, tz), 1);
    return formatInTimeZone(d, tz, 'yyyy-MM-dd');
  }

  private async resolveRoomIdForTarget(
    property: PropertyEntity,
    target: { channelId: number; extProp: string; storedRoomId: string | null },
  ): Promise<string | null> {
    const ext = target.extProp.trim();
    if (!ext) return null;
    const stored = target.storedRoomId?.trim();
    if (stored && stored !== ext) return stored;
    const raw = await this.zodomus.getRoomRates(target.channelId, ext);
    const list = Array.isArray(raw) ? raw : [];
    if (list.length === 0) return null;

    if (list.length > 1) {
      const summary = list
        .slice(0, 12)
        .map((r) => {
          const o = r as { id?: string | number; name?: string };
          const rid = o.id != null ? String(o.id) : '?';
          const label = o.name?.trim();
          return label ? `${rid} (${label})` : rid;
        })
        .join('; ');
      this.logger.warn(
        `Zodomus availability: property ${property.id} channel ${target.channelId} — Zodomus returned ${list.length} rooms but no distinct room id is stored. Rooms from API: ${summary}${list.length > 12 ? ' …' : ''}`,
      );
    }

    const first = list[0] as { id?: string | number } | undefined;
    const id = first?.id;
    return id != null && String(id).trim() !== '' ? String(id) : null;
  }
}
