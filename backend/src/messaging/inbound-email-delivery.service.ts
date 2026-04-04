import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { RESEND_INBOUND_EMAIL_QUEUE } from './inbound-email.constants';
import { MessagingService } from './messaging.service';
import type { ResendWebhookDto } from './dto/resend-webhook.dto';

export interface ResendInboundEmailJobPayload {
  ownerId: string;
  dto: ResendWebhookDto;
}

const QUEUE_ADD_RETRIES = 4;
const QUEUE_ADD_DELAYS_MS = [0, 200, 500, 1000];

@Injectable()
export class InboundEmailDeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InboundEmailDeliveryService.name);
  private queue: Queue<ResendInboundEmailJobPayload> | null = null;
  private worker: Worker<ResendInboundEmailJobPayload> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly messaging: MessagingService,
  ) {}

  get redisUrl(): string | undefined {
    const u = this.config.get<string>('REDIS_URL')?.trim();
    return u || undefined;
  }

  /** When true, POST /webhooks/resend enqueues work; otherwise processing stays synchronous. */
  useQueue(): boolean {
    return Boolean(this.redisUrl);
  }

  async onModuleInit(): Promise<void> {
    if (!this.redisUrl) {
      this.logger.log(
        'REDIS_URL not set — Resend inbound email is processed synchronously (no BullMQ queue).',
      );
      return;
    }

    const connection = { url: this.redisUrl };

    this.queue = new Queue<ResendInboundEmailJobPayload>(RESEND_INBOUND_EMAIL_QUEUE, {
      connection,
    });

    this.worker = new Worker<ResendInboundEmailJobPayload>(
      RESEND_INBOUND_EMAIL_QUEUE,
      async (job) => {
        await this.messaging.processInbound(job.data.dto, job.data.ownerId);
      },
      {
        connection,
        concurrency: 4,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Inbound email job failed id=${job?.id}: ${(err as Error).message}`,
      );
    });

    this.logger.log(`Resend inbound email queue: ${RESEND_INBOUND_EMAIL_QUEUE} (Redis)`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /**
   * Strategy B + A (EMAILdeliveryTZ): retry queue.add; on total failure caller deletes dedup and returns 5xx.
   */
  async enqueueWithRetries(externalId: string, payload: ResendInboundEmailJobPayload): Promise<void> {
    if (!this.queue) {
      throw new Error('Inbound email queue not initialized');
    }
    let lastErr: unknown;
    for (let i = 0; i < QUEUE_ADD_RETRIES; i++) {
      const delay = QUEUE_ADD_DELAYS_MS[i] ?? 1000;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      try {
        await this.queue.add('process', payload, {
          jobId: externalId,
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { count: 5000 },
          removeOnFail: { age: 86_400 },
        });
        return;
      } catch (e) {
        lastErr = e;
        this.logger.warn(
          `queue.add attempt ${i + 1}/${QUEUE_ADD_RETRIES} failed for ${externalId}: ${(e as Error).message}`,
        );
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}
