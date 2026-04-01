import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZodomusService } from './zodomus.service';
import { ZodomusSyncService } from './zodomus-sync.service';

/**
 * Polls the Zodomus reservations-queue on a configurable interval as a backup to webhooks.
 * Uses Node.js setInterval (no @nestjs/schedule dependency needed).
 *
 * Env:
 *   ZODOMUS_POLL_INTERVAL_MINUTES  — default 15
 *   ZODOMUS_DEFAULT_CHANNEL_ID     — default 1 (Booking.com)
 */
@Injectable()
export class ZodomusCronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ZodomusCronService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly zodomusService: ZodomusService,
    private readonly syncService: ZodomusSyncService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.zodomusService.isEnabled) {
      this.logger.log('Zodomus disabled — queue polling not started');
      return;
    }

    const intervalMinutes = this.config.get<number>('ZODOMUS_POLL_INTERVAL_MINUTES') ?? 15;
    const intervalMs = intervalMinutes * 60_000;

    this.logger.log(`Zodomus queue polling started (every ${intervalMinutes} min)`);
    this.timer = setInterval(() => void this.pollAll(), intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
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
