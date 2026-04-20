import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
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

/** Returned by `pushAvailabilityNow` / `executePush` for APIs and debugging. */
export type AvailabilityPushSummary = {
  /** At least one availability segment was enqueued (BullMQ) or POSTed (inline). */
  pushed: boolean;
  /** Rows after merging consecutive nights with same availability (per target room). */
  segmentCount: number;
  /** How many segment operations were dispatched (targets × segments, skipping missing roomId). */
  segmentsDispatched: number;
  /** Zodomus push targets (channel + external listing) considered. */
  targetCount: number;
  /** Nights evaluated from RentAI bookings for this window. */
  nightsEvaluated: number;
  dispatchMode: 'bullmq' | 'inline';
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

type PushTarget = { channelId: number; extProp: string; storedRoomId: string | null };

export type AvailabilityPushTargetRow = {
  channelId: number;
  externalListingId: string;
  zodomusRoomIdFromDb: string | null;
  resolvedRoomId: string | null;
  roomRatesCount: number;
  roomRatesPreview: string;
  resolutionNote: string | null;
};

export type AvailabilityPushTargetsDescription = {
  propertyId: string;
  propertyName: string | null;
  timezone: string;
  availabilityDispatchMode: 'bullmq' | 'inline';
  targets: AvailabilityPushTargetRow[];
  hint: string;
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
   * SUPERADMIN diagnostic: which Zodomus `roomId` RentAI will use for `POST /availability`
   * for each channel listing (matches `GET availability` → `rooms[].id`).
   */
  async describeAvailabilityPushTargets(propertyId: string): Promise<AvailabilityPushTargetsDescription> {
    if (!this.zodomus.isEnabled) {
      throw new ServiceUnavailableException('Zodomus integration is disabled');
    }
    const property = await this.propertyRepo.findOne({
      where: { id: propertyId },
      relations: ['otaPlatform', 'channelListings', 'channelListings.otaPlatform'],
    });
    if (!property) {
      throw new NotFoundException(`Property ${propertyId} not found`);
    }
    const targets = this.buildPushTargets(property);
    const rows: AvailabilityPushTargetRow[] = [];
    for (const t of targets) {
      const resolvedRoomId = await this.resolveRoomIdForTarget(property, t);
      let roomRatesCount = 0;
      let roomRatesPreview = '';
      try {
        const raw = await this.zodomus.getRoomRates(t.channelId, t.extProp.trim());
        const list = Array.isArray(raw) ? raw : [];
        roomRatesCount = list.length;
        roomRatesPreview = list
          .slice(0, 8)
          .map((r) => {
            const o = r as { id?: unknown; name?: unknown };
            const id = o.id != null ? String(o.id) : '?';
            const nm = o.name != null ? String(o.name).trim() : '';
            return nm ? `${id} (${nm})` : id;
          })
          .join('; ');
        if (list.length > 8) roomRatesPreview += ' …';
      } catch (e) {
        roomRatesPreview = `GET room-rates failed: ${String(e)}`;
      }

      let resolutionNote: string | null = null;
      const stored = t.storedRoomId?.trim();
      const ext = t.extProp.trim();
      if (stored && stored !== ext) {
        resolutionNote = `Using zodomusRoomId from DB (${stored}) — not the first room from GET room-rates.`;
      } else if (roomRatesCount > 1) {
        resolutionNote =
          'Several rooms from Zodomus — RentAI uses the FIRST room in the list unless zodomusRoomId is set on the channel listing (and differs from external listing id).';
      } else if (roomRatesCount === 0) {
        resolutionNote = 'No rooms from GET room-rates — availability push will skip this target.';
      }

      rows.push({
        channelId: t.channelId,
        externalListingId: ext,
        zodomusRoomIdFromDb: stored ?? null,
        resolvedRoomId,
        roomRatesCount,
        roomRatesPreview,
        resolutionNote,
      });
    }

    return {
      propertyId,
      propertyName: property.name ?? null,
      timezone: property.timezone?.trim() || 'UTC',
      availabilityDispatchMode: this.queue ? 'bullmq' : 'inline',
      targets: rows,
      hint:
        'Match `resolvedRoomId` to `rooms[].id` in GET availability for the same channelId + listing. POST /availability updates one room at a time.',
    };
  }

  private buildPushTargets(property: PropertyEntity): PushTarget[] {
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
    return targets;
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
  async pushAvailabilityNow(propertyId: string, options?: PushAvailabilityOptions): Promise<AvailabilityPushSummary> {
    try {
      const summary = await this.executePush(propertyId, options);
      if (summary.pushed && !this.queue) {
        // If inline executed successfully, clear dirty flag.
        await this.clearDirty(propertyId);
      }
      return summary;
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

  private pushSummary(
    partial: Partial<AvailabilityPushSummary> & Pick<AvailabilityPushSummary, 'dispatchMode'>,
  ): AvailabilityPushSummary {
    return {
      pushed: partial.pushed ?? false,
      segmentCount: partial.segmentCount ?? 0,
      segmentsDispatched: partial.segmentsDispatched ?? 0,
      targetCount: partial.targetCount ?? 0,
      nightsEvaluated: partial.nightsEvaluated ?? 0,
      dispatchMode: partial.dispatchMode,
    };
  }

  /** Computes segments and enqueues or POSTs them to Zodomus. */
  private async executePush(propertyId: string, options?: PushAvailabilityOptions): Promise<AvailabilityPushSummary> {
    const dispatchMode: 'bullmq' | 'inline' = this.queue ? 'bullmq' : 'inline';
    const auto = this.config.get<boolean>('ZODOMUS_AUTO_PUSH_AVAILABILITY') ?? true;
    if (!auto && !options?.ignoreAutoPushDisable) {
      return this.pushSummary({ dispatchMode });
    }
    if (!this.zodomus.isEnabled) {
      throw new ServiceUnavailableException('Zodomus integration is disabled');
    }

    const property = await this.propertyRepo.findOne({
      where: { id: propertyId },
      relations: ['otaPlatform', 'channelListings', 'channelListings.otaPlatform'],
    });
    if (!property) return this.pushSummary({ dispatchMode });

    const targets = this.buildPushTargets(property);
    if (targets.length === 0) return this.pushSummary({ dispatchMode, targetCount: 0 });

    const tz = property.timezone?.trim() || 'UTC';
    const now = new Date();
    const todayKey = formatInTimeZone(now, tz, 'yyyy-MM-dd');

    // Night keys in property TZ (same semantics as nightOverlapsBooking). Avoid mixing wall-clock
    // duration (ceil ms / 86400000) with addDays(startInstant, i) — DST and check-in/out instants
    // can skip the booked night or shrink the window to zero while the booking still exists in DB.
    const horizonDays = Math.min(730, Math.max(1, this.config.get<number>('ZODOMUS_AVAILABILITY_HORIZON_DAYS') ?? 366));
    const anchorNoon = fromZonedTime(`${todayKey}T12:00:00`, tz);

    let rangeStartKey = todayKey;
    let rangeEndExclusiveKey = formatInTimeZone(addDays(anchorNoon, horizonDays), tz, 'yyyy-MM-dd');

    const maxExclusiveKey = formatInTimeZone(addDays(anchorNoon, 730), tz, 'yyyy-MM-dd');
    if (rangeEndExclusiveKey > maxExclusiveKey) {
      rangeEndExclusiveKey = maxExclusiveKey;
    }

    if (options?.dateFromISO) {
      const fromKey = formatInTimeZone(new Date(options.dateFromISO), tz, 'yyyy-MM-dd');
      if (fromKey > rangeStartKey) rangeStartKey = fromKey;
    }
    if (options?.dateToISO) {
      const toKeyExclusive = formatInTimeZone(new Date(options.dateToISO), tz, 'yyyy-MM-dd');
      if (toKeyExclusive < rangeEndExclusiveKey) rangeEndExclusiveKey = toKeyExclusive;
    }

    if (rangeStartKey >= rangeEndExclusiveKey) {
      this.logger.warn(
        `Zodomus availability: empty night window (${rangeStartKey}..${rangeEndExclusiveKey} exclusive) for property ${propertyId} — skipping push`,
      );
      return this.pushSummary({ dispatchMode, targetCount: targets.length, nightsEvaluated: 0 });
    }

    const nightKeys = this.enumerateNightKeys(rangeStartKey, rangeEndExclusiveKey, tz);
    if (nightKeys.length === 0) {
      this.logger.warn(
        `Zodomus availability: no nights enumerated for property ${propertyId} (${rangeStartKey}..${rangeEndExclusiveKey} exclusive)`,
      );
      return this.pushSummary({ dispatchMode, targetCount: targets.length, nightsEvaluated: 0 });
    }

    const bookings = await this.bookingRepo.find({ where: { propertyId } });
    const blocking = bookings.filter((b) => !NON_BLOCKING.has(String(b.status)));

    const days: { key: string; availability: number }[] = nightKeys.map((nightKey) => {
      const occupied = blocking.some((b) => this.nightOverlapsBooking(nightKey, b, tz));
      return { key: nightKey, availability: occupied ? 0 : 1 };
    });

    const segments = this.mergeSegments(days, tz);

    let segmentsDispatched = 0;
    for (const t of targets) {
      const roomId = await this.resolveRoomIdForTarget(property, t);
      if (!roomId) {
        this.logger.warn(
          `Zodomus availability: no room id for property ${propertyId} channel ${t.channelId} — set room id on the channel row or ensure GET /room-rates returns rooms`,
        );
        continue;
      }

      if (segments.length === 0) {
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
          propertyId,
        };

        if (this.queue) {
          // Deduplicate same segment updates in queue
          const jobId = `zodomus-avail-${propertyId}-${t.channelId}-${roomId}-${seg.dateFrom}-${seg.dateToExclusive}-${seg.availability}`;
          await this.queue.add('push-segment', payload, {
            jobId,
            attempts: 5,
            backoff: { type: 'exponential', delay: 60000 },
            removeOnComplete: true,
            removeOnFail: { age: 86400 },
          });
        } else {
          await this.zodomus.setAvailability(
            t.channelId,
            t.extProp,
            roomId,
            seg.dateFrom,
            seg.dateToExclusive,
            seg.availability,
          );
        }
        segmentsDispatched += 1;
      }
      this.logger.log(
        `Zodomus availability: property ${propertyId} channel ${t.channelId} — ${segments.length} segment(s) enqueued/pushed.`,
      );
    }

    return this.pushSummary({
      pushed: segmentsDispatched > 0,
      segmentCount: segments.length,
      segmentsDispatched,
      targetCount: targets.length,
      nightsEvaluated: nightKeys.length,
      dispatchMode,
    });
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

  /** Every local calendar night in [startKey, endExclusiveKey); keys are yyyy-MM-dd in property tz. */
  private enumerateNightKeys(startKey: string, endExclusiveKey: string, tz: string): string[] {
    const out: string[] = [];
    for (let k = startKey; k < endExclusiveKey; k = this.dayAfterInTz(k, tz)) {
      out.push(k);
      if (out.length > 800) {
        this.logger.warn(
          `Zodomus availability: night enumeration cap (800) for ${startKey}..${endExclusiveKey} — truncating`,
        );
        break;
      }
    }
    return out;
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
