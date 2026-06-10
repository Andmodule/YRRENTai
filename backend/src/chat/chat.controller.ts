import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiOperation } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { AuthGuard } from '@nestjs/passport';
import { ChatService } from './chat.service';
import { StaffReplyService } from './staff-reply.service';
import { StaffOutboundDeliveryService } from './staff-outbound-delivery.service';
import { ConversationService } from './conversation.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { PropertyService } from '../property/property.service';
import { UserService } from '../user/user.service';
import {
  listConversationsQuerySchema,
  managerReplySchema,
  aiDraftApproveSchema,
  replyAnalyticsQuerySchema,
} from '@rentai/shared';
import { AiReplySettingsService } from './ai-reply-settings.service';
import { AiDraftApprovalService } from './ai-draft-approval.service';
import type { ConversationStatus } from '@rentai/shared';
import { StorageService } from '../modules/storage/storage.service';

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
    private readonly staffOutboundDelivery: StaffOutboundDeliveryService,
    private readonly config: ConfigService,
    private readonly userService: UserService,
    private readonly storageService: StorageService,
    private readonly aiReplySettings: AiReplySettingsService,
    private readonly aiDraftApproval: AiDraftApprovalService,
  ) {}

  @Get('ai-reply-settings')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'AI reply mode (auto-send vs manager approval)' })
  getAiReplySettings() {
    return {
      data: {
        requiresApproval: this.aiReplySettings.requiresApproval(),
      },
    };
  }

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

    const ownerId = await this.userService.resolveTenantOwnerId(user!.sub, user!.role);
    const result = await this.conversationService.listForOwner(ownerId, {
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

  @Post('conversations/:conversationId/staff-attachments')
  @Roles('OWNER', 'MANAGER')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  @ApiOperation({
    summary: 'Upload one file for a manager reply (stored in R2); include the returned object in POST /chats/conversations/reply `attachments`',
  })
  async uploadStaffConversationAttachment(
    @Param('conversationId') conversationId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user?: JwtPayload,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('file is required');
    }
    const conv = await this.conversationService.findById(conversationId);
    await this.propertyService.findOneForUser(conv.propertyId, user!.sub, user!.role);
    if (!this.storageService.isConfigured()) {
      throw new BadRequestException('File storage is not configured');
    }
    const { key } = await this.storageService.uploadStaffConversationAttachment(
      conv.propertyId,
      conv.id,
      file.buffer,
      file.originalname || 'file',
      file.mimetype || 'application/octet-stream',
    );
    return {
      data: {
        id: uuidv4(),
        fileName: file.originalname || 'file',
        contentType: file.mimetype || 'application/octet-stream',
        sizeBytes: file.size,
        storageKey: key,
      },
    };
  }

  @Get('messages/:messageId/whatsapp-file')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({
    summary: 'Redirect to a short-lived signed URL for WhatsApp media stored in R2 (inbox message)',
  })
  async downloadWhatsappInboundFile(
    @Param('messageId') messageId: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ): Promise<void> {
    const msg = await this.chatService.findMessageById(messageId);
    if (!msg?.conversationId) {
      throw new NotFoundException('Message not found');
    }
    const meta = msg.metadata;
    if (
      !meta ||
      typeof meta !== 'object' ||
      !('channel' in meta) ||
      (meta as { channel?: string }).channel !== 'whatsapp_inbound'
    ) {
      throw new BadRequestException('Not a WhatsApp inbound attachment message');
    }
    const storageKey = (meta as { storageKey?: string }).storageKey?.trim();
    if (!storageKey) {
      throw new NotFoundException('No file stored for this message (configure R2 or media unavailable)');
    }
    const conv = await this.conversationService.findById(msg.conversationId);
    await this.propertyService.findOneForUser(conv.propertyId, user.sub, user.role);
    if (!this.storageService.isConfigured()) {
      throw new BadRequestException('File storage is not configured');
    }
    const url = await this.storageService.getPresignedDownloadUrl(storageKey, 900);
    res.redirect(302, url);
  }

  @Get('messages/:messageId/staff-attachments/:attachmentId/download')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Redirect to a presigned URL for a staff-outbound attachment (inbox message)' })
  async downloadStaffOutboundAttachment(
    @Param('messageId') messageId: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ): Promise<void> {
    const msg = await this.chatService.findMessageById(messageId);
    if (!msg?.conversationId) {
      throw new NotFoundException('Message not found');
    }
    const meta = msg.metadata;
    if (
      !meta ||
      typeof meta !== 'object' ||
      !('channel' in meta) ||
      (meta as { channel?: string }).channel !== 'staff_outbound'
    ) {
      throw new BadRequestException('Not a staff attachment message');
    }
    const attachments = (meta as { attachments?: Array<{ id: string; storageKey?: string }> }).attachments;
    const att = attachments?.find((a) => a.id === attachmentId);
    if (!att?.storageKey?.trim()) {
      throw new NotFoundException('Attachment not found');
    }
    const conv = await this.conversationService.findById(msg.conversationId);
    await this.propertyService.findOneForUser(conv.propertyId, user.sub, user.role);
    if (!this.storageService.isConfigured()) {
      throw new BadRequestException('File storage is not configured');
    }
    const url = await this.storageService.getPresignedDownloadUrl(att.storageKey, 900);
    res.redirect(302, url);
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
    const ownerId = await this.userService.resolveTenantOwnerId(user!.sub, user!.role);
    const properties = await this.propertyService.findAllByOwner(ownerId);
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

  @Post('dev/conversations/:id/clear')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'DEV: delete one conversation and its messages (linked email threads / escalations)' })
  async clearConversationDev(@Param('id') id: string, @CurrentUser() user?: JwtPayload) {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException('Chat wipe is disabled in production');
    }
    const conv = await this.conversationService.findById(id);
    await this.propertyService.findOneForUser(conv.propertyId, user!.sub, user!.role);
    await this.chatService.clearConversationForDev(id);
    return { data: { ok: true, conversationId: id } };
  }

  @Post('messages/:messageId/retry')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Retry delivery for a staff message that failed (ERROR → PENDING → …)' })
  async retryStaffMessageDelivery(
    @Param('messageId') messageId: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    const msg = await this.chatService.findMessageById(messageId);
    if (!msg?.conversationId) {
      throw new NotFoundException('Message not found');
    }
    const conv = await this.conversationService.findById(msg.conversationId);
    await this.propertyService.findOneForUser(conv.propertyId, user!.sub, user!.role);
    const updated = await this.staffOutboundDelivery.retryFailedDelivery(messageId);
    return {
      data: {
        id: updated.id,
        conversationId: updated.conversationId,
        deliveryStatus: updated.deliveryStatus,
        channel: updated.channel,
      },
    };
  }

  @Post('messages/:messageId/ai-draft/approve')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Approve (optionally edit) an AI draft and deliver it to the guest' })
  async approveAiDraft(
    @Param('messageId') messageId: string,
    @Body() body: unknown,
    @CurrentUser() user?: JwtPayload,
  ) {
    const parsed = aiDraftApproveSchema.parse(body ?? {});
    const msg = await this.chatService.findMessageById(messageId);
    if (!msg?.conversationId) {
      throw new NotFoundException('Message not found');
    }
    const conv = await this.conversationService.findById(msg.conversationId);
    await this.propertyService.findOneForUser(conv.propertyId, user!.sub, user!.role);
    const updated = await this.aiDraftApproval.approveDraft({
      messageId,
      content: parsed.content,
      userId: user!.sub,
    });
    return {
      data: {
        ...this.chatService.toSocketPayload(updated),
        conversationId: updated.conversationId,
        metadata: updated.metadata
          ? this.chatService.sanitizeMetadataForApi(updated.metadata)
          : undefined,
      },
    };
  }

  @Post('messages/:messageId/ai-draft/reject')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Reject an AI draft (not sent to the guest)' })
  async rejectAiDraft(
    @Param('messageId') messageId: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    const msg = await this.chatService.findMessageById(messageId);
    if (!msg?.conversationId) {
      throw new NotFoundException('Message not found');
    }
    const conv = await this.conversationService.findById(msg.conversationId);
    await this.propertyService.findOneForUser(conv.propertyId, user!.sub, user!.role);
    await this.aiDraftApproval.rejectDraft(messageId);
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

    await this.propertyService.findOneForUser(conv.propertyId, user!.sub, user!.role);

    const savedMessage = await this.staffReplyService.applyStaffReply({
      propertyId: conv.propertyId,
      conversationId: conv.id,
      content: parsed.content,
      attachments: parsed.attachments,
      userId: user!.sub,
    });

    return {
      data: {
        id: savedMessage.id,
        conversationId: conv.id,
        content: savedMessage.content,
        role: 'assistant',
        source: 'staff',
        channel: savedMessage.channel,
        deliveryStatus: savedMessage.deliveryStatus,
        createdAt: savedMessage.createdAt.toISOString(),
        ...(savedMessage.metadata
          ? { metadata: this.chatService.sanitizeMetadataForApi(savedMessage.metadata) }
          : {}),
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
      await this.propertyService.findOneForUser(propertyId, user.sub, user.role);
    }
    return this.chatService.getMessages(propertyId, Number(page) || 1, Number(limit) || 50);
  }
}
