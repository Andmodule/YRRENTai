import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ICalSyncService } from './ical-sync.service';

/**
 * Periodically imports all saved iCal URLs across all properties.
 * Interval: ICAL_POLL_INTERVAL_MINUTES (default 60 min).
 */
@Injectable()
export class ICalCronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ICalCronService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly syncService: ICalSyncService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const minutes = this.config.get<number>('ICAL_POLL_INTERVAL_MINUTES') ?? 60;
    const ms = minutes * 60_000;
    this.logger.log(`iCal cron started (every ${minutes} min)`);
    this.timer = setInterval(() => void this.run(), ms);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async run(): Promise<void> {
    this.logger.debug('iCal cron: syncing all properties');
    try {
      const { properties, results } = await this.syncService.syncAllProperties();
      const totals = results.reduce(
        (acc, r) => {
          acc.imported += r.imported;
          acc.updated += r.updated;
          acc.cancelled += r.cancelled;
          acc.failed += r.failed;
          return acc;
        },
        { imported: 0, updated: 0, cancelled: 0, failed: 0 },
      );
      if (properties > 0) {
        this.logger.log(
          `iCal cron done: properties=${properties} imported=${totals.imported} updated=${totals.updated} cancelled=${totals.cancelled} failed=${totals.failed}`,
        );
      }
    } catch (e) {
      this.logger.error(`iCal cron error: ${String(e)}`);
    }
  }
}
