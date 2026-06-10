import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { stripEscalationForGuestDisplay } from '@rentai/shared';
import { ChatMessageEntity } from './entities/chat-message.entity';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { StaffOutboundDeliveryService } from './staff-outbound-delivery.service';
import { ChatGateway } from './chat.gateway';
import { MessageDeliveryStatus } from './enums/message-delivery-status.enum';

@Injectable()
export class AiDraftApprovalService {
  private readonly logger = new Logger(AiDraftApprovalService.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly conversationService: ConversationService,
    private readonly staffOutboundDelivery: StaffOutboundDeliveryService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
    @InjectRepository(ChatMessageEntity)
    private readonly messageRepository: Repository<ChatMessageEntity>,
  ) {}

  async supersedePendingDrafts(conversationId: string): Promise<void> {
    const rows = await this.messageRepository.find({
      where: {
        conversationId,
        role: 'assistant',
        source: 'ai',
        deliveryStatus: MessageDeliveryStatus.DRAFT,
      },
    });
    if (rows.length === 0) return;
    await this.messageRepository.remove(rows);
    for (const row of rows) {
      this.emitDraftRemoved(row);
    }
  }

  async approveDraft(params: {
    messageId: string;
    content?: string;
    userId: string;
  }): Promise<ChatMessageEntity> {
    const msg = await this.loadPendingDraft(params.messageId);
    const edited = params.content?.trim();
    if (edited) {
      msg.content = stripEscalationForGuestDisplay(edited) || edited;
    }
    if (!msg.content.trim()) {
      throw new BadRequestException('Draft content cannot be empty');
    }

    msg.deliveryStatus = MessageDeliveryStatus.PENDING;
    await this.messageRepository.save(msg);
    this.emitMessageUpdated(msg);

    await this.staffOutboundDelivery.deliverApprovedAiDraft(msg);

    const fresh = await this.messageRepository.findOne({ where: { id: msg.id } });
    if (!fresh) {
      throw new NotFoundException('Message not found after delivery');
    }

    if (fresh.deliveryStatus === MessageDeliveryStatus.SENT && fresh.conversationId) {
      await this.conversationService.setStatus(fresh.conversationId, 'resolved');
      await this.conversationService.touch(fresh.conversationId, fresh.content);
      this.chatGateway.server
        ?.to(`inbox:${fresh.propertyId}`)
        .emit('conversation:updated', {
          conversationId: fresh.conversationId,
          status: 'resolved',
          lastMessagePreview: fresh.content.slice(0, 200),
          lastActivityAt: fresh.createdAt.toISOString(),
        });
    }

    this.emitMessageUpdated(fresh);
    return fresh;
  }

  async rejectDraft(messageId: string): Promise<void> {
    const msg = await this.loadPendingDraft(messageId);
    const conversationId = msg.conversationId;
    await this.messageRepository.remove(msg);
    this.emitDraftRemoved(msg);

    if (!conversationId) return;

    const lastUser = await this.messageRepository.findOne({
      where: { conversationId, role: 'user' },
      order: { createdAt: 'DESC' },
    });
    const preview = lastUser?.content?.slice(0, 200) ?? null;
    await this.conversationService.setStatus(conversationId, 'needs_human');
    if (preview) {
      await this.conversationService.touch(conversationId, preview);
    }
    this.chatGateway.server?.to(`inbox:${msg.propertyId}`).emit('conversation:updated', {
      conversationId,
      status: 'needs_human',
      ...(preview ? { lastMessagePreview: preview } : {}),
      lastActivityAt: new Date().toISOString(),
    });
  }

  private async loadPendingDraft(messageId: string): Promise<ChatMessageEntity> {
    const msg = await this.messageRepository.findOne({ where: { id: messageId } });
    if (!msg) {
      throw new NotFoundException(`Message ${messageId} not found`);
    }
    if (msg.role !== 'assistant' || msg.source !== 'ai') {
      throw new BadRequestException('Only AI assistant drafts can be approved or rejected');
    }
    if (msg.deliveryStatus !== MessageDeliveryStatus.DRAFT) {
      throw new BadRequestException('Message is not a pending AI draft');
    }
    return msg;
  }

  private emitMessageUpdated(msg: ChatMessageEntity): void {
    const payload = {
      ...this.chatService.toSocketPayload(msg),
      conversationId: msg.conversationId,
    };
    this.chatGateway.server?.to(`property:${msg.propertyId}`).emit('message:saved', payload);
    this.chatGateway.server?.to(`inbox:${msg.propertyId}`).emit('message:saved', payload);
    this.chatGateway.emitMessageDeliveryStatus({
      propertyId: msg.propertyId,
      conversationId: msg.conversationId,
      messageId: msg.id,
      deliveryStatus: msg.deliveryStatus,
      channel: msg.channel,
    });
  }

  private emitDraftRemoved(msg: ChatMessageEntity): void {
    this.chatGateway.server?.to(`property:${msg.propertyId}`).emit('message:draft_removed', {
      propertyId: msg.propertyId,
      conversationId: msg.conversationId,
      messageId: msg.id,
    });
    this.chatGateway.server?.to(`inbox:${msg.propertyId}`).emit('message:draft_removed', {
      propertyId: msg.propertyId,
      conversationId: msg.conversationId,
      messageId: msg.id,
    });
  }
}
