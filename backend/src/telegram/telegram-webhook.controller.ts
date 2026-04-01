import { Controller, Post, Body, Headers, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import { TelegramService } from './telegram.service';

@ApiTags('Telegram')
@Controller('telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(
    private readonly telegramService: TelegramService,
    private readonly configService: ConfigService,
  ) {}

  @ApiExcludeEndpoint()
  @Post('webhook')
  async handleWebhook(
    @Body() body: unknown,
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
  ) {
    const expectedSecret = this.configService.get<string>('TELEGRAM_WEBHOOK_SECRET');
    const raw = body as {
      update_id?: number;
      message?: {
        message_id?: number;
        reply_to_message?: { message_id?: number };
        text?: string;
      };
    };

    /** Любой update — иначе в логах не видно, дошёл ли вебхук до этого инстанса (localhost без туннеля / другой URL). */
    const hasReply = !!raw?.message?.reply_to_message;
    this.logger.log(
      `Telegram webhook: update_id=${raw?.update_id ?? '?'} has_message=${!!raw?.message} reply_to=${hasReply} new_msg_id=${raw?.message?.message_id ?? 'n/a'}`,
    );

    if (expectedSecret && secret !== expectedSecret) {
      this.logger.warn(
        'Telegram webhook: rejected (set TELEGRAM_WEBHOOK_SECRET empty or pass the same secret in setWebhook secret_token + header X-Telegram-Bot-Api-Secret-Token)',
      );
      throw new UnauthorizedException('Invalid webhook secret');
    }

    try {
      if (hasReply) {
        this.logger.log(
          `Telegram webhook: reply_to_bot_message_id=${raw.message!.reply_to_message!.message_id} new_message_id=${raw.message!.message_id}`,
        );
      }
      await this.telegramService.handleWebhookUpdate(body as Parameters<TelegramService['handleWebhookUpdate']>[0]);
    } catch (err) {
      this.logger.error(`Webhook processing error: ${(err as Error).message}`);
    }

    return { ok: true };
  }
}
