import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class TelegramMetricsService implements OnModuleInit {
  private readonly logger = new Logger(TelegramMetricsService.name);
  readonly registry = new Registry();

  readonly escalationJobsEnqueued: Counter;
  readonly escalationDelivery: Counter<'status'>;
  readonly incidentNotify: Counter<'status'>;

  constructor(private readonly configService: ConfigService) {
    this.escalationJobsEnqueued = new Counter({
      name: 'rentai_telegram_escalation_jobs_enqueued_total',
      help: 'Escalation Telegram jobs enqueued to Redis (BullMQ)',
      registers: [this.registry],
    });
    this.escalationDelivery = new Counter({
      name: 'rentai_telegram_escalation_delivery_total',
      help: 'Escalation Telegram delivery result',
      labelNames: ['status'],
      registers: [this.registry],
    });
    this.incidentNotify = new Counter({
      name: 'rentai_telegram_incident_notify_total',
      help: 'Incident Telegram notify result',
      labelNames: ['status'],
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    if (this.configService.get<boolean>('METRICS_ENABLED') === true) {
      collectDefaultMetrics({ register: this.registry, prefix: 'rentai_node_' });
      this.logger.log('Prometheus metrics enabled (METRICS_ENABLED=true)');
    }
  }
}
