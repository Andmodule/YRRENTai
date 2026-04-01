import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Logger,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { ZodomusSyncService } from './zodomus-sync.service';

interface ZodomusWebhookBody {
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
 * Payload: { webhookKey, token, channelId, propertyId, reservationId, reservationStatus }
 * reservationStatus: 1=new, 2=modified, 3=cancelled
 */
@ApiTags('Zodomus')
@Controller('integrations/zodomus')
export class ZodomusWebhookController {
  private readonly logger = new Logger(ZodomusWebhookController.name);

  constructor(
    private readonly syncService: ZodomusSyncService,
    private readonly config: ConfigService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(@Body() body: ZodomusWebhookBody): Promise<{ ok: boolean }> {
    const expectedKey = this.config.get<string>('ZODOMUS_WEBHOOK_KEY');
    if (expectedKey) {
      if (!body.webhookKey || body.webhookKey !== expectedKey) {
        this.logger.warn('Zodomus webhook: invalid webhookKey');
        throw new ForbiddenException('Invalid webhook key');
      }
    }

    const channelId = Number(body.channelId ?? 1);
    const propertyId = String(body.propertyId ?? '').trim();
    const reservationId = String(body.reservationId ?? '').trim();
    const reservationStatus = Number(body.reservationStatus ?? 1);

    if (!propertyId || !reservationId || !Number.isFinite(channelId)) {
      this.logger.warn(`Zodomus webhook: missing fields — ${JSON.stringify(body)}`);
      return { ok: true }; // always return 200 to prevent Zodomus retry storms
    }

    this.logger.log(
      `Webhook: channelId=${channelId} propertyId=${propertyId} reservationId=${reservationId} status=${reservationStatus}`,
    );

    try {
      await this.syncService.processWebhookEvent(propertyId, channelId, reservationId, reservationStatus);
    } catch (e) {
      this.logger.error(`Webhook processing error: ${String(e)}`);
      // still return 200 so Zodomus doesn't retry indefinitely
    }

    return { ok: true };
  }
}
