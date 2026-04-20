import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { VoiceAlertsService } from './voice-alerts.service';

/**
 * Periodically evaluates voice alert rules against current metrics.
 * Runs every minute. Anti-flapping is handled inside VoiceAlertsService
 * via recoveryStreak — alerts auto-resolve only after 3 consecutive
 * healthy evaluation cycles (~3 minutes).
 *
 * Prerequisites: @nestjs/schedule must be installed and ScheduleModule.forRoot()
 * registered in AppModule (or VoiceModule).
 */
@Injectable()
export class VoiceAlertSchedulerService {
  private readonly logger = new Logger(VoiceAlertSchedulerService.name);

  constructor(private readonly alertsService: VoiceAlertsService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'voice_alert_evaluation' })
  async runEvaluation(): Promise<void> {
    try {
      const result = await this.alertsService.evaluateAlerts();
      if (result.created > 0 || result.autoResolved > 0) {
        this.logger.log(
          `Alert eval: +${result.created} new, ${result.refreshed} refreshed, ` +
          `${result.recovering} recovering, ${result.autoResolved} auto-resolved`,
        );
      }
    } catch (err) {
      this.logger.error('Alert evaluation failed', err instanceof Error ? err.stack : String(err));
    }
  }
}
