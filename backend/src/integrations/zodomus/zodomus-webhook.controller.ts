import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { ZodomusSyncService } from './zodomus-sync.service';

interface ZodomusWebhookBody {
  /** Zodomus sends the key in either `webhookKey` or `token` depending on API type. */
  webhookKey?: string;
  token?: string;
  channelId?: number | string;
  propertyId?: string;
  reservationId?: string;
  reservationStatus?: number | string;
}

/**
 * Public endpoint — no JWT.
 * Zodomus calls this when a reservation is created, modified, or cancelled.
 * Payload: { webhookKey|token, channelId, propertyId, reservationId, reservationStatus }
 * reservationStatus: 1=new, 2=modified, 3=cancelled
 *
 * IMPORTANT — return codes:
 *   200 → delivery accepted (field-validation failures, unknown property → silently skip)
 *   403 → wrong webhook key (Zodomus will NOT retry — intentional)
 *   500 → transient DB/API error → Zodomus WILL retry (correct behavior for prod)
 */
@ApiTags('Zodomus')
@Controller('integrations/zodomus')
export class ZodomusWebhookController implements OnModuleInit {
  private readonly logger = new Logger(ZodomusWebhookController.name);

  constructor(
    private readonly syncService: ZodomusSyncService,
    private readonly config: ConfigService,
  ) {}

  /** Log a loud warning on startup when ZODOMUS_WEBHOOK_KEY is not configured. */
  onModuleInit(): void {
    const key = this.config.get<string>('ZODOMUS_WEBHOOK_KEY');
    if (!key?.trim()) {
      this.logger.warn(
        '⚠️  ZODOMUS_WEBHOOK_KEY is not set — the webhook endpoint is UNAUTHENTICATED. ' +
          'Set ZODOMUS_WEBHOOK_KEY in .env and configure the same key in Zodomus → Webhook Key.',
      );
    }
  }

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(@Body() body: ZodomusWebhookBody): Promise<{ ok: boolean }> {
    const expectedKey = this.config.get<string>('ZODOMUS_WEBHOOK_KEY')?.trim();

    // Zodomus sends the secret in either `webhookKey` (Webhook API type) or `token` (API Call type).
    const incomingKey = (body.webhookKey ?? body.token ?? '').trim();

    if (expectedKey) {
      if (!incomingKey || incomingKey !== expectedKey) {
        this.logger.warn(`Zodomus webhook: invalid key — received="${incomingKey.slice(0, 8)}…"`);
        throw new ForbiddenException('Invalid webhook key');
      }
    }

    const channelId = Number(body.channelId ?? 1);
    const propertyId = String(body.propertyId ?? '').trim();
    const reservationId = String(body.reservationId ?? '').trim();
    const reservationStatus = Number(body.reservationStatus ?? 1);

    // Field-validation failures: return 200 so Zodomus doesn't retry bad payloads indefinitely.
    if (!propertyId || !reservationId || !Number.isFinite(channelId)) {
      this.logger.warn(`Zodomus webhook: missing required fields — ${JSON.stringify(body)}`);
      return { ok: true };
    }

    this.logger.log(
      `Webhook received: channelId=${channelId} propertyId=${propertyId} reservationId=${reservationId} status=${reservationStatus}`,
    );

    // Processing errors (DB, Zodomus API) → 500 so Zodomus retries delivery.
    try {
      await this.syncService.processWebhookEvent(propertyId, channelId, reservationId, reservationStatus);
    } catch (e) {
      this.logger.error(`Webhook processing failed — will signal Zodomus to retry: ${String(e)}`);
      throw new InternalServerErrorException('Webhook processing failed — please retry');
    }

    return { ok: true };
  }
}
