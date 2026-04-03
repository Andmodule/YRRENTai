import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { TELEGRAM_ESCALATION_QUEUE } from './telegram.constants';
import {
  TelegramEscalationDeliveryPayload,
  TelegramEscalationSenderService,
} from './telegram-escalation-sender.service';
import { TelegramMetricsService } from './telegram-metrics.service';
import { withRetry } from './telegram-retries.util';

@Injectable()
export class TelegramDeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramDeliveryService.name);
  private queue: Queue<TelegramEscalationDeliveryPayload> | null = null;
  private worker: Worker<TelegramEscalationDeliveryPayload> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly sender: TelegramEscalationSenderService,
    private readonly metrics: TelegramMetricsService,
  ) {}

  /** Non-empty when BullMQ should be used. */
  get redisUrl(): string | undefined {
    const u = this.configService.get<string>('REDIS_URL')?.trim();
    return u || undefined;
  }

  async onModuleInit(): Promise<void> {
    const url = this.redisUrl;
    if (!url) {
      this.logger.log(
        'REDIS_URL not set — Telegram escalations use inline retries (no BullMQ queue).',
      );
      return;
    }

    const connection = { url };

    this.queue = new Queue<TelegramEscalationDeliveryPayload>(TELEGRAM_ESCALATION_QUEUE, {
      connection,
    });

    this.worker = new Worker<TelegramEscalationDeliveryPayload>(
      TELEGRAM_ESCALATION_QUEUE,
      async (job) => {
        await this.sender.deliverEscalationOnce(job.data);
      },
      {
        connection,
        concurrency: 4,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Telegram escalation job failed id=${job?.id} escalationId=${job?.data?.escalationId}: ${(err as Error).message}`,
      );
    });

    this.logger.log(`Telegram escalation queue: ${TELEGRAM_ESCALATION_QUEUE} (Redis)`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async enqueueOrDeliver(payload: TelegramEscalationDeliveryPayload): Promise<void> {
    if (this.queue) {
      await this.queue.add('deliver', payload, {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 4000,
        },
        removeOnComplete: { count: 5000 },
        removeOnFail: { age: 86_400 },
      });
      this.metrics.escalationJobsEnqueued.inc();
      return;
    }

    await withRetry(() => this.sender.deliverEscalationOnce(payload), {
      maxAttempts: 4,
      delayMs: (i) => Math.min(1500 * 2 ** i, 30_000),
    });
  }

  async getQueueHealth(): Promise<{
    mode: 'redis' | 'inline';
    counts?: Record<string, number>;
  }> {
    if (this.queue) {
      const counts = await this.queue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'failed',
        'completed',
        'paused',
      );
      return { mode: 'redis', counts };
    }
    return { mode: 'inline' };
  }
}
