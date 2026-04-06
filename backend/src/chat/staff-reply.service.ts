import { BadRequestException, Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { stripEscalationForGuestDisplay } from '@rentai/shared';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { ChatGateway } from './chat.gateway';
import { StaffOutboundDeliveryService } from './staff-outbound-delivery.service';
import { StaffRepliedEvent } from '../common/events/staff.events';
import { resolveGuestEscalationFallback } from '../agent/constants/agent-prompts';
import { ChatMessageEntity } from './entities/chat-message.entity';
import { MessageDeliveryStatus } from './enums/message-delivery-status.enum';

/**
 * Saves manager reply to chat DB, pushes to WebSocket clients, and relays to guest email.
 * MessagingService is injected via forwardRef (ChatModule ↔ MessagingModule mutual forwardRef).
 */
@Injectable()
export class StaffReplyService {
  private readonly logger = new Logger(StaffReplyService.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly conversationService: ConversationService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
    private readonly staffOutboundDelivery: StaffOutboundDeliveryService,
  ) {}

  async applyStaffReply(params: {
    propertyId: string;
    conversationId: string;
    content: string;
    userId?: string | null;
    /** Если задан (эскалация из почты), релей в email ищет `messaging_threads` даже при рассинхроне `conversation_id`. */
    relayMessagingThreadId?: string | null;
    /**
     * Дождаться завершения outbound (email и т.д.), чтобы вернуть финальный `deliveryStatus`.
     * Нужно для ответа из Telegram: подтверждение «доставлено» только при SENT.
     */
    awaitOutboundDelivery?: boolean;
  }): Promise<ChatMessageEntity> {
    const conv = await this.conversationService.findById(params.conversationId.trim());
    if (conv.propertyId !== params.propertyId) {
      throw new BadRequestException('Conversation does not belong to this property');
    }

    const replyBody =
      stripEscalationForGuestDisplay(params.content) || resolveGuestEscalationFallback(params.content);

    const targetChannel = await this.chatService.resolveOutboundChannel(conv.id, conv.channel);

    const savedMessage = await this.chatService.saveMessage({
      propertyId: conv.propertyId,
      conversationId: conv.id,
      userId: params.userId ?? undefined,
      content: replyBody,
      role: 'assistant',
      source: 'staff',
      channel: targetChannel,
      deliveryStatus: MessageDeliveryStatus.PENDING,
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
        savedMessage.channel,
        savedMessage.deliveryStatus,
      ),
    );

    this.logger.log(`Staff reply saved: conv=${conv.id} messageId=${savedMessage.id}`);

    const relayOpts = { messagingThreadId: params.relayMessagingThreadId ?? undefined };
    const mustAwait =
      params.awaitOutboundDelivery === true || !!params.relayMessagingThreadId?.trim();

    /** Async delivery: статус PENDING → SENT/ERROR и WS `message_status_updated`. */
    if (mustAwait) {
      try {
        await this.staffOutboundDelivery.routeStaffOutbound(savedMessage, relayOpts);
        if (params.relayMessagingThreadId?.trim()) {
          this.logger.log(
            `Outbound delivery OK (thread anchor) conv=${conv.id} thread=${params.relayMessagingThreadId}`,
          );
        }
      } catch (e) {
        this.logger.error(`Outbound delivery failed for conv=${conv.id}`, e as Error);
      }
    } else {
      void this.staffOutboundDelivery.routeStaffOutbound(savedMessage, relayOpts).catch((e) =>
        this.logger.error(`Outbound delivery failed for conv=${conv.id}`, e as Error),
      );
    }

    const reloaded = await this.chatService.findMessageById(savedMessage.id);
    return reloaded ?? savedMessage;
  }
}
