import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ChatService } from './chat.service';
import { StaffReplyService } from './staff-reply.service';
import { ConversationService } from './conversation.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { PropertyService } from '../property/property.service';
import {
  listConversationsQuerySchema,
  managerReplySchema,
  replyAnalyticsQuerySchema,
} from '@rentai/shared';
import type { ConversationStatus } from '@rentai/shared';

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('chats')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly conversationService: ConversationService,
    private readonly propertyService: PropertyService,
    private readonly staffReplyService: StaffReplyService,
    private readonly config: ConfigService,
  ) {}

  /** Static paths must be registered before `:propertyId/messages` so they are not captured as UUIDs. */
  @Get('conversations')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'List conversations for the current owner (paginated, filterable)' })
  async listConversations(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('propertyId') propertyId?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    const parsed = listConversationsQuerySchema.safeParse({
      page: page ?? 1,
      limit: limit ?? 20,
      status: status === '' ? undefined : status,
      propertyId: propertyId === '' ? undefined : propertyId,
    });

    const q = parsed.success ? parsed.data : { page: 1, limit: 20 };

    const result = await this.conversationService.listForOwner(user!.sub, {
      page: q.page,
      limit: q.limit,
      status: q.status as ConversationStatus | undefined,
      propertyId: q.propertyId,
    });
    return { data: result };
  }

  @Get('conversations/:id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Get a single conversation by ID' })
  async getConversation(@Param('id') id: string) {
    const conv = await this.conversationService.findById(id);
    return { data: conv };
  }

  @Get('conversations/:id/messages')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Get the last N messages for a conversation (chronological, tail of thread)' })
  async getConversationMessages(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    const conv = await this.conversationService.findById(id);
    const lim = Number(limit) || 100;
    return this.chatService.getLastMessagesForConversation(conv.propertyId, conv.id, lim);
  }

  @Get('analytics/reply-stats')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'AI vs manual assistant replies for your properties in a date range' })
  async getReplyAnalytics(
    @Query('from') fromRaw: string,
    @Query('to') toRaw: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    const parsed = replyAnalyticsQuerySchema.safeParse({ from: fromRaw, to: toRaw });
    if (!parsed.success) {
      throw new BadRequestException('Invalid or missing from/to (use ISO 8601 datetimes)');
    }
    const { from, to } = parsed.data;
    const properties = await this.propertyService.findAllByOwner(user!.sub);
    const propertyIds = properties.map((p) => p.id);
    const { ai, staff } = await this.chatService.getReplyStats(propertyIds, from, to);
    const total = ai + staff;
    const aiPercent = total === 0 ? null : Math.round((ai / total) * 1000) / 10;

    return {
      data: {
        ai,
        staff,
        aiPercent,
        from: from.toISOString(),
        to: to.toISOString(),
      },
    };
  }

  /** Must stay above `:propertyId` routes. Disabled when NODE_ENV=production. */
  @Post('dev/clear-all')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({
    summary: 'DEV: delete all conversations, chat messages, messaging threads, and escalations',
  })
  async clearAllChatsDev() {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException('Chat wipe is disabled in production');
    }
    await this.chatService.clearAllChatsForDev();
    return { data: { ok: true } };
  }

  @Post('conversations/reply')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Manager replies to a conversation (resolves it)' })
  async replyToConversation(
    @Body() body: unknown,
    @CurrentUser() user?: JwtPayload,
  ) {
    const parsed = managerReplySchema.parse(body);
    const conv = await this.conversationService.findById(parsed.conversationId);

    await this.propertyService.findOne(conv.propertyId, user!.sub);

    const savedMessage = await this.staffReplyService.applyStaffReply({
      propertyId: conv.propertyId,
      conversationId: conv.id,
      content: parsed.content,
      userId: user!.sub,
    });

    return {
      data: {
        id: savedMessage.id,
        conversationId: conv.id,
        content: savedMessage.content,
        role: 'assistant',
        source: 'staff',
        createdAt: savedMessage.createdAt.toISOString(),
      },
    };
  }

  @Get(':propertyId/messages')
  @Roles('OWNER', 'MANAGER')
  async getMessages(
    @Param('propertyId') propertyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    if (user) {
      await this.propertyService.findOne(propertyId, user.sub);
    }
    return this.chatService.getMessages(propertyId, Number(page) || 1, Number(limit) || 50);
  }
}
