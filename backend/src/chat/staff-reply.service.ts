import { BadRequestException, forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { stripEscalationForGuestDisplay } from '@rentai/shared';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { ChatGateway } from './chat.gateway';
import { StaffRepliedEvent } from '../common/events/staff.events';
import { MessagingService } from '../messaging/messaging.service';
import { resolveGuestEscalationFallback } from '../agent/constants/agent-prompts';
import { ChatMessageEntity } from './entities/chat-message.entity';

/**
 * Сохранение ответа менеджера (чат + сокеты) и явный релей на email гостя через MessagingService.
 */
@Injectable()
export class StaffReplyService {
  private readonly logger = new Logger(StaffReplyService.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly conversationService: ConversationService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
    @Inject(forwardRef(() => MessagingService))
    private readonly messagingService: MessagingService,
  ) {}

  async applyStaffReply(params: {
    propertyId: string;
    conversationId: string;
    content: string;
    userId?: string | null;
  }): Promise<ChatMessageEntity> {
    const conv = await this.conversationService.findById(params.conversationId.trim());
    if (conv.propertyId !== params.propertyId) {
      throw new BadRequestException('Conversation does not belong to this property');
    }

    const replyBody =
      stripEscalationForGuestDisplay(params.content) || resolveGuestEscalationFallback(params.content);

    const savedMessage = await this.chatService.saveMessage({
      propertyId: conv.propertyId,
      conversationId: conv.id,
      userId: params.userId ?? undefined,
      content: replyBody,
      role: 'assistant',
      source: 'staff',
    });

    try {
      await this.messagingService.relayStaffReplyToEmailGuest(conv.id, replyBody);
    } catch (err) {
      this.logger.error(`Staff reply email relay failed for conversation ${conv.id}`, err as Error);
    }

    await this.conversationService.setStatus(conv.id, 'resolved');
    await this.conversationService.touch(conv.id, replyBody);

    /** Сокеты и список слева — сразу; email может подвиснуть на Resend и раньше блокировал весь ответ. */
    this.chatGateway.emitStaffReplyToSockets(
      new StaffRepliedEvent(
        conv.propertyId,
        savedMessage.id,
        replyBody,
        savedMessage.createdAt.toISOString(),
        conv.id,
      ),
    );

    return savedMessage;
  }
}
