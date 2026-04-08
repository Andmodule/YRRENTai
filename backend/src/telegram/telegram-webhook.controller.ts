import {
  Controller,
  Post,
  Body,
  Headers,
  UnauthorizedException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import { TelegramService } from './telegram.service';
import { StaffTelegramBotService } from './staff-telegram-bot.service';

@ApiTags('Telegram')
@Controller('telegram')
export class TelegramWebhookController implements OnModuleInit {
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(
    private readonly telegramService: TelegramService,
    private readonly staffTelegramBot: StaffTelegramBotService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const port = this.configService.get<number>('PORT') ?? 3000;
    const publicBase =
      this.configService.get<string>('API_PUBLIC_URL')?.replace(/\/$/, '') ?? `http://127.0.0.1:${port}`;
    const mainPath = '/api/v1/telegram/webhook';
    const staffPath = '/api/v1/telegram/staff-webhook';
    this.logger.log(
      `Telegram (client/manager bot): setWebhook → ${publicBase}${mainPath} (TELEGRAM_WEBHOOK_SECRET).`,
    );
    this.logger.log(
      `Telegram (staff bot): setWebhook → ${publicBase}${staffPath} (TELEGRAM_STAFF_WEBHOOK_SECRET).`,
    );
  }

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

  @ApiExcludeEndpoint()
  @Post('staff-webhook')
  async handleStaffWebhook(
    @Body() body: unknown,
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
  ) {
    const expectedSecret = this.configService.get<string>('TELEGRAM_STAFF_WEBHOOK_SECRET');
    const raw = body as {
      update_id?: number;
      message?: {
        message_id?: number;
        reply_to_message?: { message_id?: number };
        text?: string;
      };
    };
    const hasReply = !!raw?.message?.reply_to_message;
    this.logger.log(
      `Telegram staff webhook: update_id=${raw?.update_id ?? '?'} has_message=${!!raw?.message} reply_to=${hasReply}`,
    );

    if (expectedSecret && secret !== expectedSecret) {
      this.logger.warn(
        'Telegram staff webhook: rejected (set TELEGRAM_STAFF_WEBHOOK_SECRET empty or match setWebhook secret_token + X-Telegram-Bot-Api-Secret-Token)',
      );
      throw new UnauthorizedException('Invalid webhook secret');
    }

    try {
      await this.staffTelegramBot.handleStaffBotWebhook(
        body as Parameters<StaffTelegramBotService['handleStaffBotWebhook']>[0],
      );
    } catch (err) {
      this.logger.error(`Staff webhook processing error: ${(err as Error).message}`);
    }

    return { ok: true };
  }
}
