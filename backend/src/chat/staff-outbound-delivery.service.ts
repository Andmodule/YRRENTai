import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatMessageEntity } from './entities/chat-message.entity';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { ChatGateway } from './chat.gateway';
import { MessagingService } from '../messaging/messaging.service';
import { MessageChannel } from './enums/message-channel.enum';
import { MessageDeliveryStatus } from './enums/message-delivery-status.enum';

@Injectable()
export class StaffOutboundDeliveryService {
  private readonly logger = new Logger(StaffOutboundDeliveryService.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly conversationService: ConversationService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
    @Inject(forwardRef(() => MessagingService))
    private readonly messagingService: MessagingService,
    @InjectRepository(ChatMessageEntity)
    private readonly messageRepository: Repository<ChatMessageEntity>,
  ) {}

  async routeStaffOutbound(
    message: ChatMessageEntity,
    relayOpts?: { messagingThreadId?: string | null },
  ): Promise<void> {
    const fresh = await this.messageRepository.findOne({ where: { id: message.id } });
    if (!fresh) {
      this.logger.warn(`routeStaffOutbound: message ${message.id} not found`);
      return;
    }
    if (fresh.source !== 'staff' || fresh.role !== 'assistant') {
      return;
    }

    const conv = fresh.conversationId
      ? await this.conversationService.findById(fresh.conversationId).catch(() => null)
      : null;
    if (!conv) {
      this.logger.error(`routeStaffOutbound: no conversation for message ${fresh.id}`);
      fresh.deliveryStatus = MessageDeliveryStatus.ERROR;
      await this.messageRepository.save(fresh);
      this.emitStatus(fresh);
      return;
    }

    try {
      this.logger.log(
        `Dispatching staff message [${fresh.id}] via [${fresh.channel}] for conversation [${conv.id}]`,
      );

      switch (fresh.channel) {
        case MessageChannel.BOOKING_API:
        case MessageChannel.EMAIL:
          await this.messagingService.relayStaffReplyToEmailGuest(conv.id, fresh.content, {
            messagingThreadId: relayOpts?.messagingThreadId ?? undefined,
          });
          break;
        case MessageChannel.TELEGRAM:
          throw new NotImplementedException(
            `Guest delivery via ${fresh.channel} is not implemented yet.`,
          );
        case MessageChannel.AIRBNB_API:
        case MessageChannel.WHATSAPP:
          throw new NotImplementedException(`Integration for ${fresh.channel} is not yet implemented.`);
        default:
          throw new Error(`Unknown channel: ${String(fresh.channel)}`);
      }

      fresh.deliveryStatus = MessageDeliveryStatus.SENT;
      this.logger.log(`Message [${fresh.id}] delivered via ${fresh.channel}`);
    } catch (error) {
      this.logger.error(`Failed to deliver message [${fresh.id}] via ${fresh.channel}`, error as Error);
      fresh.deliveryStatus = MessageDeliveryStatus.ERROR;
    } finally {
      await this.messageRepository.save(fresh);
      this.emitStatus(fresh);
    }
  }

  async retryFailedDelivery(messageId: string): Promise<ChatMessageEntity> {
    const message = await this.messageRepository.findOne({ where: { id: messageId } });
    if (!message) {
      throw new NotFoundException(`Message ${messageId} not found`);
    }
    if (message.source !== 'staff' || message.role !== 'assistant') {
      throw new BadRequestException('Only staff assistant messages can be retried');
    }
    if (message.deliveryStatus !== MessageDeliveryStatus.ERROR) {
      throw new BadRequestException('Only messages with ERROR delivery status can be retried');
    }

    message.deliveryStatus = MessageDeliveryStatus.PENDING;
    await this.messageRepository.save(message);
    this.emitStatus(message);

    void this.routeStaffOutbound(message, {}).catch((err) =>
      this.logger.error(`Retry delivery failed for ${messageId}`, err as Error),
    );

    return message;
  }

  private emitStatus(m: ChatMessageEntity): void {
    this.chatGateway.emitMessageDeliveryStatus({
      propertyId: m.propertyId,
      conversationId: m.conversationId,
      messageId: m.id,
      deliveryStatus: m.deliveryStatus,
      channel: m.channel,
    });
  }
}
