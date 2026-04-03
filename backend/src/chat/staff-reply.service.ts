import { BadRequestException, forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { stripEscalationForGuestDisplay } from '@rentai/shared';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { ChatGateway } from './chat.gateway';
import { StaffRepliedEvent } from '../common/events/staff.events';
import { resolveGuestEscalationFallback } from '../agent/constants/agent-prompts';
import { ChatMessageEntity } from './entities/chat-message.entity';

/**
 * Saves manager reply to chat DB and pushes it to WebSocket clients.
 * Email relay is intentionally left to the caller (ChatController / TelegramService)
 * so that each entry-point can use its already-resolved MessagingService reference
 * without an extra forwardRef proxy layer.
 */
@Injectable()
export class StaffReplyService {
  private readonly logger = new Logger(StaffReplyService.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly conversationService: ConversationService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
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

    await this.conversationService.setStatus(conv.id, 'resolved');
    await this.conversationService.touch(conv.id, replyBody);

    this.chatGateway.emitStaffReplyToSockets(
      new StaffRepliedEvent(
        conv.propertyId,
        savedMessage.id,
        replyBody,
        savedMessage.createdAt.toISOString(),
        conv.id,
      ),
    );

    this.logger.log(`Staff reply saved: conv=${conv.id} messageId=${savedMessage.id}`);
    return savedMessage;
  }
}
