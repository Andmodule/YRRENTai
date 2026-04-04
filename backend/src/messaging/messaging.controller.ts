import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { MessagingService } from './messaging.service';
import { ResendWebhookDto } from './dto/resend-webhook.dto';
import { SendReplyDto } from './dto/send-reply.dto';
import { ResendWebhookGuard } from './guards/resend-webhook.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { InboundEmailDedupService } from './inbound-email-dedup.service';
import { extractResendWebhookEventId } from './resend-webhook.util';

/** Domains whose email is forwarded by Booking.com on behalf of guests. */
const SENDER_ALLOWLIST = ['guest.booking.com', 'mchat.booking.com'];

/**
 * Extract the host (lowercased) from a raw RFC 5322 From header.
 * `"Name" <user@host>` → `host`; bare `user@host` → `host`.
 */
function senderHost(from: string): string {
  const angle = from.match(/<([^>]+)>/);
  const addr = angle?.[1]?.trim() ?? from.trim();
  const at = addr.lastIndexOf('@');
  return at >= 0 ? addr.slice(at + 1).toLowerCase() : '';
}

@ApiTags('Messaging')
@Controller('webhooks')
export class MessagingWebhookController {
  private readonly logger = new Logger(MessagingWebhookController.name);

  constructor(
    private readonly messaging: MessagingService,
    private readonly config: ConfigService,
    private readonly inboundDedup: InboundEmailDedupService,
  ) {}

  @Post('resend')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ResendWebhookGuard)
  async handleInbound(@Body() dto: ResendWebhookDto): Promise<{ ok: true }> {
    const ownerId = this.config.get<string>('RESEND_DEFAULT_OWNER_ID');
    if (!ownerId) {
      throw new BadRequestException('RESEND_DEFAULT_OWNER_ID is not configured');
    }

    const from = dto.data?.from ?? '';
    const host = senderHost(from);

    const allowGmail = process.env.INBOUND_ALLOW_GMAIL_TEST === 'true';
    const allowed =
      SENDER_ALLOWLIST.includes(host) ||
      (allowGmail && (host === 'gmail.com' || host === 'googlemail.com'));

    if (!allowed) {
      this.logger.log(`Inbound drop: host=${host || '(empty)'} from=${from.slice(0, 120)}`);
      return { ok: true };
    }

    this.logger.log(`Inbound accept: host=${host} from=${from.slice(0, 120)}`);

    const eventId = extractResendWebhookEventId(dto.data);
    if (eventId) {
      const inserted = await this.inboundDedup.tryInsertResendEvent(eventId);
      if (!inserted) {
        return { ok: true };
      }
    }

    await this.messaging.processInbound(dto, ownerId);
    return { ok: true };
  }
}

@ApiTags('Messaging')
@ApiBearerAuth()
@Controller('messages')
@UseGuards(AuthGuard('jwt'))
export class MessagingRestController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('threads')
  async getThreads(@CurrentUser() user: JwtPayload) {
    return this.messaging.getThreads(user.sub);
  }

  @Get('threads/:threadId')
  async getThread(
    @Param('threadId') threadId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.messaging.getThreadWithMessages(threadId, user.sub);
  }

  @Post('threads/:threadId/reply')
  @HttpCode(HttpStatus.OK)
  async sendReply(
    @Param('threadId') threadId: string,
    @Body() dto: SendReplyDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ ok: true }> {
    await this.messaging.sendReply(threadId, dto.text, user.sub);
    return { ok: true };
  }
}
