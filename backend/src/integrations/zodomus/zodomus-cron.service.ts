import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PropertyChannelListingEntity } from '../../property/entities/property-channel-listing.entity';
import { ZodomusService } from './zodomus.service';
import { ZodomusSyncService } from './zodomus-sync.service';
import { ZodomusAvailabilityPushService } from './zodomus-availability-push.service';

/**
 * Polls the Zodomus reservations-queue on a configurable interval as a backup to webhooks.
 * Iterates ALL channel ids found across property_channel_listings (not just ZODOMUS_DEFAULT_CHANNEL_ID).
 * Also retries failed availability pushes (dirty flag) and runs a nightly full reconcile.
 * Uses Node.js setInterval (no @nestjs/schedule dependency needed).
 *
 * Env:
 *   ZODOMUS_POLL_INTERVAL_MINUTES             — default 360 (6 hours)
 *   ZODOMUS_POLL_ON_STARTUP                   — default true (one poll after boot)
 *   ZODOMUS_INITIAL_POLL_DELAY_MS             — default 20000
 *   ZODOMUS_DEFAULT_CHANNEL_ID                — fallback channel id when no listings exist (default 1)
 *   ZODOMUS_AVAILABILITY_DIRTY_RETRY_MINUTES  — default 15
 *   ZODOMUS_AVAILABILITY_NIGHTLY_HOUR_UTC     — default 3
 *   ZODOMUS_AVAILABILITY_BATCH_GAP_MS         — pause between channels/properties (default 1000)
 */
@Injectable()
export class ZodomusCronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ZodomusCronService.name);
  private pollTimer: NodeJS.Timeout | null = null;
  private dirtyTimer: NodeJS.Timeout | null = null;
  private minuteTimer: NodeJS.Timeout | null = null;
  private startupPollTimer: NodeJS.Timeout | null = null;
  private lastNightlyUtcDate: string | null = null;

  constructor(
    private readonly zodomusService: ZodomusService,
    private readonly syncService: ZodomusSyncService,
    private readonly availabilityPush: ZodomusAvailabilityPushService,
    private readonly config: ConfigService,
    @InjectRepository(PropertyChannelListingEntity)
    private readonly listingRepo: Repository<PropertyChannelListingEntity>,
  ) {}

  onModuleInit(): void {
    if (!this.zodomusService.isEnabled) {
      this.logger.log('Zodomus disabled — queue polling and availability cron not started');
      return;
    }

    const intervalMinutes = this.config.get<number>('ZODOMUS_POLL_INTERVAL_MINUTES') ?? 360;
    const intervalMs = intervalMinutes * 60_000;

    this.logger.log(`Zodomus queue polling started (every ${intervalMinutes} min)`);
    this.pollTimer = setInterval(() => void this.pollAll(), intervalMs);

    const pollOnStartup = this.config.get<boolean>('ZODOMUS_POLL_ON_STARTUP') ?? true;
    if (pollOnStartup) {
      const delayMs = this.config.get<number>('ZODOMUS_INITIAL_POLL_DELAY_MS') ?? 20_000;
      this.startupPollTimer = setTimeout(() => {
        this.startupPollTimer = null;
        void this.pollAll();
      }, delayMs);
      this.logger.log(`Zodomus startup queue poll scheduled in ${delayMs} ms`);
    }

    const dirtyMinutes = this.config.get<number>('ZODOMUS_AVAILABILITY_DIRTY_RETRY_MINUTES') ?? 15;
    const dirtyMs = dirtyMinutes * 60_000;
    this.logger.log(`Zodomus availability dirty retry started (every ${dirtyMinutes} min)`);
    this.dirtyTimer = setInterval(() => void this.availabilityPush.retryDirtyProperties(), dirtyMs);

    this.minuteTimer = setInterval(() => void this.tickNightly(), 60_000);
    const nightlyHour = this.config.get<number>('ZODOMUS_AVAILABILITY_NIGHTLY_HOUR_UTC') ?? 3;
    this.logger.log(
      `Zodomus nightly availability reconcile: UTC ${String(nightlyHour).padStart(2, '0')}:00 (if enabled)`,
    );
  }

  onModuleDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.dirtyTimer) {
      clearInterval(this.dirtyTimer);
      this.dirtyTimer = null;
    }
    if (this.minuteTimer) {
      clearInterval(this.minuteTimer);
      this.minuteTimer = null;
    }
    if (this.startupPollTimer) {
      clearTimeout(this.startupPollTimer);
      this.startupPollTimer = null;
    }
  }

  private async tickNightly(): Promise<void> {
    const enabled = this.config.get<boolean>('ZODOMUS_AVAILABILITY_NIGHTLY_FULL_PUSH') ?? true;
    if (!enabled || !this.zodomusService.isEnabled) return;
    const hour = this.config.get<number>('ZODOMUS_AVAILABILITY_NIGHTLY_HOUR_UTC') ?? 3;
    const now = new Date();
    if (now.getUTCHours() !== hour || now.getUTCMinutes() !== 0) return;
    const d = now.toISOString().slice(0, 10);
    if (this.lastNightlyUtcDate === d) return;
    this.lastNightlyUtcDate = d;
    await this.availabilityPush.nightlyReconcileAll();
  }

  /**
   * Resolves the set of all Zodomus channel ids present in property_channel_listings.
   * Falls back to ZODOMUS_DEFAULT_CHANNEL_ID when no listings exist (legacy single-channel setup).
   */
  private async resolveAllChannelIds(): Promise<number[]> {
    const rows = await this.listingRepo
      .createQueryBuilder('cl')
      .innerJoin('cl.otaPlatform', 'op')
      .select('op.zodomusChannelId', 'channelId')
      .where('op.zodomusChannelId IS NOT NULL')
      .distinct(true)
      .getRawMany<{ channelId: number }>();

    const ids = rows
      .map((r) => Number(r.channelId))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (ids.length === 0) {
      const def = Number(this.config.get<string>('ZODOMUS_DEFAULT_CHANNEL_ID') ?? 1);
      return [def];
    }
    return ids;
  }

  private async pollAll(): Promise<void> {
    const gapMs = this.config.get<number>('ZODOMUS_AVAILABILITY_BATCH_GAP_MS') ?? 1000;

    let channelIds: number[];
    try {
      channelIds = await this.resolveAllChannelIds();
    } catch (e) {
      this.logger.error(`Cron poll: could not resolve channel ids: ${String(e)}`);
      return;
    }

    this.logger.debug(`Cron poll: channels=${channelIds.join(',')}`);

    for (const channelId of channelIds) {
      try {
        const result = await this.syncService.syncAllProperties(channelId);
        if (result.propertiesTouched > 0) {
          this.logger.log(
            `Cron poll ch=${channelId}: properties=${result.propertiesTouched} processed=${result.processed} skipped=${result.skipped} failed=${result.failed}`,
          );
        }
      } catch (e) {
        this.logger.error(`Cron poll ch=${channelId} error: ${String(e)}`);
      }
      if (gapMs > 0 && channelIds.length > 1) {
        await new Promise((r) => setTimeout(r, gapMs));
      }
    }
  }
}
