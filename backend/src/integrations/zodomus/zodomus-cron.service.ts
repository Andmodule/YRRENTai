import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZodomusService } from './zodomus.service';
import { ZodomusSyncService } from './zodomus-sync.service';
import { ZodomusAvailabilityPushService } from './zodomus-availability-push.service';

/**
 * Polls the Zodomus reservations-queue on a configurable interval as a backup to webhooks.
 * Also retries failed availability pushes (dirty flag) and runs a nightly full reconcile.
 * Uses Node.js setInterval (no @nestjs/schedule dependency needed).
 *
 * Env:
 *   ZODOMUS_POLL_INTERVAL_MINUTES  — default 360 (6 hours)
 *   ZODOMUS_DEFAULT_CHANNEL_ID     — default 1 (Booking.com)
 *   ZODOMUS_AVAILABILITY_DIRTY_RETRY_MINUTES — default 15
 *   ZODOMUS_AVAILABILITY_NIGHTLY_HOUR_UTC — default 3
 */
@Injectable()
export class ZodomusCronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ZodomusCronService.name);
  private pollTimer: NodeJS.Timeout | null = null;
  private dirtyTimer: NodeJS.Timeout | null = null;
  private minuteTimer: NodeJS.Timeout | null = null;
  private lastNightlyUtcDate: string | null = null;

  constructor(
    private readonly zodomusService: ZodomusService,
    private readonly syncService: ZodomusSyncService,
    private readonly availabilityPush: ZodomusAvailabilityPushService,
    private readonly config: ConfigService,
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

  private async pollAll(): Promise<void> {
    const channelId = Number(this.config.get<string>('ZODOMUS_DEFAULT_CHANNEL_ID') ?? 1);
    this.logger.debug(`Cron poll: channelId=${channelId}`);
    try {
      const result = await this.syncService.syncAllProperties(channelId);
      if (result.propertiesTouched > 0) {
        this.logger.log(
          `Cron poll done: properties=${result.propertiesTouched} processed=${result.processed} skipped=${result.skipped} failed=${result.failed}`,
        );
      }
    } catch (e) {
      this.logger.error(`Cron poll error: ${String(e)}`);
    }
  }
}
