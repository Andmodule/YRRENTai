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
import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { BOOKING_STATUS } from '@rentai/shared';
import { BookingEntity } from '../../booking/entities/booking.entity';
import { PropertyEntity } from '../../property/entities/property.entity';
import { ZodomusService } from './zodomus.service';
import { isZodomusPermanentMisconfiguration, zodomusErrorFingerprint } from './zodomus-status.util';

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

/** Widen date window when several debounced triggers stack for one property. */
function mergeAvailabilityPushOptions(
  prev: PushAvailabilityOptions | undefined,
  next: PushAvailabilityOptions | undefined,
): PushAvailabilityOptions | undefined {
  if (!prev) return next;
  if (!next) return prev;
  const out: PushAvailabilityOptions = {
    ignoreAutoPushDisable: Boolean(prev.ignoreAutoPushDisable || next.ignoreAutoPushDisable),
  };
  const pick = (mode: 'min' | 'max', a?: string, b?: string): string | undefined => {
    const ta = a ? Date.parse(a) : NaN;
    const tb = b ? Date.parse(b) : NaN;
    const vals = [ta, tb].filter(Number.isFinite) as number[];
    if (vals.length === 0) return undefined;
    const ts = mode === 'min' ? Math.min(...vals) : Math.max(...vals);
    return new Date(ts).toISOString();
  };
  const df = pick('min', prev.dateFromISO, next.dateFromISO);
  const dt = pick('max', prev.dateToISO, next.dateToISO);
  if (df) out.dateFromISO = df;
  if (dt) out.dateToISO = dt;
  return out;
}

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

@Injectable()
export class ZodomusAvailabilityPushService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ZodomusAvailabilityPushService.name);
  private queue: Queue<AvailabilitySegment> | null = null;
  private worker: Worker<AvailabilitySegment> | null = null;

  /** Debounce `scheduleAvailabilityPush` per property (see ZODOMUS_AVAILABILITY_PUSH_DEBOUNCE_MS). */
  private readonly _pushDebounceTimer = new Map<string, NodeJS.Timeout>();
  private readonly _pushAccumulatedOptions = new Map<string, PushAvailabilityOptions | undefined>();

  /**
   * Per-property mutex: prevents concurrent availability pushes for the same property.
   * When a push is already in flight, new callers receive the same promise (coalescing).
   */
  private readonly _inFlightPush = new Map<string, Promise<AvailabilityPushSummary>>();

  /**
   * Sliding-window call timestamps for the inline (no-Redis) rate limiter.
   * Shared across all properties — mirrors what BullMQ limiter does for the queue worker.
   */
  private readonly _inlineCallTimestamps: number[] = [];

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
      const maxPerMin = this.config.get<number>('ZODOMUS_AVAILABILITY_MAX_PER_MINUTE') ?? 40;
      this.logger.warn(
        `REDIS_URL not set — Zodomus availability push runs synchronously (NOT RECOMMENDED for production). ` +
          `Inline rate limiter active: max ${maxPerMin} req/min. Configure REDIS_URL for BullMQ queue.`,
      );
      return;
    }

    const connection = { url };
    
    this.queue = new Queue<AvailabilitySegment>('zodomus-availability', { connection });

    const maxPerMinute = this.config.get<number>('ZODOMUS_AVAILABILITY_MAX_PER_MINUTE') ?? 40;

    this.worker = new Worker<AvailabilitySegment>(
      'zodomus-availability',
      async (job) => {
        const { channelId, extProp, roomId, dateFrom, dateToExclusive, availability, propertyId } = job.data;
        try {
          await this.zodomus.setAvailability(channelId, extProp, roomId, dateFrom, dateToExclusive, availability);
          await this.sleepBetweenAvailabilityPosts();
        } catch (e) {
          if (isZodomusPermanentMisconfiguration(e)) {
            await this.clearDirty(propertyId);
            this.recordAvailFailure(propertyId, true);
            throw new UnrecoverableError(zodomusErrorFingerprint(e));
          }
          throw e;
        }
      },
      {
        connection,
        concurrency: 1,
        limiter: {
          max: maxPerMinute,
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
      if (!job?.data.propertyId) return;
      if (isZodomusPermanentMisconfiguration(err)) {
        await this.clearDirty(job.data.propertyId);
        return;
      }
      await this.markDirty(job.data.propertyId);
    });

    this.logger.log(`Zodomus availability BullMQ queue initialized (rate limited to ${maxPerMinute} req/min).`);
  }

  async onModuleDestroy(): Promise<void> {
    for (const t of this._pushDebounceTimer.values()) {
      clearTimeout(t);
    }
    this._pushDebounceTimer.clear();
    this._pushAccumulatedOptions.clear();
    await this.worker?.close();
    await this.queue?.close();
  }

  /** Spreads POST /availability in time (partner logs often show same-second bursts). */
  private async sleepBetweenAvailabilityPosts(): Promise<void> {
    const ms = Math.max(0, this.config.get<number>('ZODOMUS_AVAILABILITY_POST_GAP_MS') ?? 1500);
    if (ms > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });
    }
  }

  /**
   * Sliding-window rate limiter for inline (no-Redis) mode.
   * Blocks until the current minute has capacity for one more POST /availability call.
   */
  private async inlineRateLimit(maxPerMinute: number): Promise<void> {
    const now = Date.now();
    const windowStart = now - 60_000;

    // Evict timestamps older than the sliding window
    let evict = 0;
    while (evict < this._inlineCallTimestamps.length && this._inlineCallTimestamps[evict]! <= windowStart) {
      evict++;
    }
    if (evict > 0) this._inlineCallTimestamps.splice(0, evict);

    if (this._inlineCallTimestamps.length >= maxPerMinute) {
      const oldest = this._inlineCallTimestamps[0]!;
      const waitMs = oldest + 60_000 - Date.now() + 250; // 250 ms safety margin
      if (waitMs > 0) {
        this.logger.warn(
          `Zodomus inline rate limit: ${maxPerMinute} req/min reached — waiting ${Math.ceil(waitMs / 1000)}s`,
        );
        await new Promise<void>((r) => setTimeout(r, waitMs));
        // Re-evict after waiting
        const after = Date.now() - 60_000;
        let j = 0;
        while (j < this._inlineCallTimestamps.length && this._inlineCallTimestamps[j]! <= after) {
          j++;
        }
        if (j > 0) this._inlineCallTimestamps.splice(0, j);
      }
    }

    this._inlineCallTimestamps.push(Date.now());
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
   * Pushes availability changes. Debounces rapid calls per property (env: ZODOMUS_AVAILABILITY_PUSH_DEBOUNCE_MS).
   * Cron / dirty / nightly passes `ignoreAutoPushDisable` and runs without debounce so backlog is not delayed.
   */
  scheduleAvailabilityPush(propertyId: string, options?: PushAvailabilityOptions): void {
    if (options?.ignoreAutoPushDisable) {
      const pending = this._pushDebounceTimer.get(propertyId);
      if (pending) {
        clearTimeout(pending);
        this._pushDebounceTimer.delete(propertyId);
      }
      const merged = mergeAvailabilityPushOptions(this._pushAccumulatedOptions.get(propertyId), options);
      this._pushAccumulatedOptions.delete(propertyId);
      void this.pushAvailabilityNow(propertyId, merged ?? options).catch((e) =>
        this.logger.warn(`Zodomus availability push failed for ${propertyId}: ${String(e)}`),
      );
      return;
    }

    const prev = this._pushAccumulatedOptions.get(propertyId);
    this._pushAccumulatedOptions.set(propertyId, mergeAvailabilityPushOptions(prev, options));

    const debounceMs = this.config.get<number>('ZODOMUS_AVAILABILITY_PUSH_DEBOUNCE_MS') ?? 2000;
    const existing = this._pushDebounceTimer.get(propertyId);
    if (existing) clearTimeout(existing);

    if (debounceMs <= 0) {
      this._pushDebounceTimer.delete(propertyId);
      const opts = this._pushAccumulatedOptions.get(propertyId);
      this._pushAccumulatedOptions.delete(propertyId);
      void this.pushAvailabilityNow(propertyId, opts).catch((e) =>
        this.logger.warn(`Zodomus availability push failed for ${propertyId}: ${String(e)}`),
      );
      return;
    }

    const timer = setTimeout(() => {
      this._pushDebounceTimer.delete(propertyId);
      const opts = this._pushAccumulatedOptions.get(propertyId);
      this._pushAccumulatedOptions.delete(propertyId);
      void this.pushAvailabilityNow(propertyId, opts).catch((e) =>
        this.logger.warn(`Zodomus availability push failed for ${propertyId}: ${String(e)}`),
      );
    }, debounceMs);
    this._pushDebounceTimer.set(propertyId, timer);
  }

  /**
   * Computes segments and enqueues/sends them to Zodomus.
   * Per-property mutex: if a push is already in flight for this property, the new caller
   * receives the same promise (coalescing) instead of firing a second concurrent push.
   */
  async pushAvailabilityNow(propertyId: string, options?: PushAvailabilityOptions): Promise<AvailabilityPushSummary> {
    const inFlight = this._inFlightPush.get(propertyId);
    if (inFlight) {
      this.logger.debug(
        `Zodomus availability push already in progress for ${propertyId} — coalescing duplicate call`,
      );
      return inFlight;
    }

    const promise = this._doPush(propertyId, options);
    this._inFlightPush.set(propertyId, promise);
    try {
      return await promise;
    } finally {
      this._inFlightPush.delete(propertyId);
    }
  }

  private async _doPush(propertyId: string, options?: PushAvailabilityOptions): Promise<AvailabilityPushSummary> {
    try {
      const summary = await this.executePush(propertyId, options);
      if (summary.pushed && !this.queue) {
        // Inline executed successfully — clear dirty flag.
        await this.clearDirty(propertyId);
      }
      return summary;
    } catch (e) {
      if (!(e instanceof ServiceUnavailableException)) {
        if (isZodomusPermanentMisconfiguration(e)) {
          await this.clearDirty(propertyId);
        } else {
          await this.markDirty(propertyId);
        }
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
        const permanent = isZodomusPermanentMisconfiguration(e);
        this.recordAvailFailure(p.id, permanent);
        if (permanent) {
          await this.clearDirty(p.id);
          this.logger.warn(`Zodomus dirty retry stopped for ${p.id} (fix external listing / activate property): ${String(e)}`);
        } else {
          const failCount = this._availFailCount.get(p.id) ?? 0;
          if (failCount < ZodomusAvailabilityPushService.AVAIL_CIRCUIT_AFTER) {
            this.logger.warn(`Dirty retry failed for ${p.id}: ${String(e)}`);
          }
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
            /** Transient errors only — permanent misconfig uses UnrecoverableError (no retry storm). */
            attempts: 2,
            backoff: { type: 'exponential', delay: 45_000 },
            removeOnComplete: true,
            removeOnFail: { age: 86400 },
          });
        } else {
          // Inline mode: enforce sliding-window rate limit before each POST /availability.
          const maxPerMin = this.config.get<number>('ZODOMUS_AVAILABILITY_MAX_PER_MINUTE') ?? 40;
          await this.inlineRateLimit(maxPerMin);
          await this.zodomus.setAvailability(
            t.channelId,
            t.extProp,
            roomId,
            seg.dateFrom,
            seg.dateToExclusive,
            seg.availability,
          );
          await this.sleepBetweenAvailabilityPosts();
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
