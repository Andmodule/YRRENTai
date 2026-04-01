import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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

@ApiTags('Messaging')
@Controller('webhooks')
export class MessagingWebhookController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly config: ConfigService,
  ) {}

  @Post('resend')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ResendWebhookGuard)
  async handleInbound(@Body() dto: ResendWebhookDto): Promise<{ ok: true }> {
    const ownerId = this.config.get<string>('RESEND_DEFAULT_OWNER_ID');
    if (!ownerId) {
      throw new BadRequestException('RESEND_DEFAULT_OWNER_ID is not configured');
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
