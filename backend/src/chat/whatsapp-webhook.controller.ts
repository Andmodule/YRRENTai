import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  Res,
  UnauthorizedException,
  Logger,
  HttpCode,
  RawBodyRequest,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { WhatsappInboundService } from './whatsapp-inbound.service';

function verifyMetaSignature(raw: Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expectedHex = signatureHeader.slice(7);
  const hmac = createHmac('sha256', appSecret).update(raw).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expectedHex, 'hex'), Buffer.from(hmac, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Meta WhatsApp Cloud API webhooks (no JWT). Configure in Meta App → WhatsApp → Configuration.
 * Callback URL: `https://<api>/api/v1/webhooks/whatsapp`
 */
@ApiExcludeController()
@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly inbound: WhatsappInboundService,
  ) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ): void {
    const verify = this.configService.get<string>('WHATSAPP_VERIFY_TOKEN')?.trim();
    if (mode === 'subscribe' && verify && token === verify) {
      res.status(200).send(challenge);
      return;
    }
    this.logger.warn('WhatsApp webhook verify failed (mode/token mismatch or WHATSAPP_VERIFY_TOKEN unset)');
    res.status(403).send();
  }

  @Post()
  @HttpCode(200)
  handle(@Req() req: RawBodyRequest<Request>, @Body() body: unknown): { success: boolean } {
    const secret = this.configService.get<string>('WHATSAPP_APP_SECRET')?.trim();
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    if (secret) {
      const raw = req.rawBody;
      const sig = req.headers['x-hub-signature-256'] as string | undefined;
      if (!raw || !Buffer.isBuffer(raw) || !verifyMetaSignature(raw, sig, secret)) {
        if (nodeEnv === 'production') {
          throw new UnauthorizedException('Invalid WhatsApp webhook signature');
        }
        this.logger.warn(
          'WhatsApp webhook: signature check failed (dev: continuing; set WHATSAPP_APP_SECRET empty only locally)',
        );
      }
    } else if (nodeEnv === 'production') {
      this.logger.warn(
        'WhatsApp webhook: WHATSAPP_APP_SECRET unset — Meta signatures not verified (not recommended)',
      );
    }

    void this.inbound.processWebhookPayload(body).catch((err) => {
      this.logger.error(`WhatsApp inbound: ${(err as Error).message}`, err as Error);
    });

    return { success: true };
  }
}
