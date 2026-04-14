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
import type { StaffOutboundMessageMetadata } from '@rentai/shared';
import { ChatMessageEntity } from './entities/chat-message.entity';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { ChatGateway } from './chat.gateway';
import { MessagingService } from '../messaging/messaging.service';
import { StorageService } from '../modules/storage/storage.service';
import { WhatsappCloudApiService } from './whatsapp-cloud-api.service';
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
    private readonly whatsappCloudApi: WhatsappCloudApiService,
    private readonly storageService: StorageService,
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

      const staffMeta = this.parseStaffOutboundMeta(fresh);
      const staffAtt = staffMeta?.attachments;

      switch (fresh.channel) {
        case MessageChannel.BOOKING_API:
        case MessageChannel.EMAIL:
          await this.messagingService.relayStaffReplyToEmailGuest(conv.id, fresh.content, {
            messagingThreadId: relayOpts?.messagingThreadId ?? undefined,
            staffAttachments: staffAtt
              ?.filter((a): a is typeof a & { storageKey: string } => !!a.storageKey?.trim())
              .map((a) => ({
                storageKey: a.storageKey,
                fileName: a.fileName,
                contentType: a.contentType,
              })),
          });
          break;
        case MessageChannel.TELEGRAM:
          throw new NotImplementedException(
            `Guest delivery via ${fresh.channel} is not implemented yet.`,
          );
        case MessageChannel.AIRBNB_API:
          throw new NotImplementedException(`Integration for ${fresh.channel} is not yet implemented.`);
        case MessageChannel.WHATSAPP:
          await this.deliverWhatsappStaff(conv, fresh, staffMeta);
          break;
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

  private parseStaffOutboundMeta(m: ChatMessageEntity): StaffOutboundMessageMetadata | null {
    const meta = m.metadata;
    if (!meta || typeof meta !== 'object' || !('channel' in meta)) {
      return null;
    }
    if ((meta as { channel?: string }).channel !== 'staff_outbound') {
      return null;
    }
    return meta as StaffOutboundMessageMetadata;
  }

  private async deliverWhatsappStaff(
    conv: { id: string; propertyId: string; externalGuestKey?: string | null },
    fresh: ChatMessageEntity,
    staffMeta: StaffOutboundMessageMetadata | null,
  ): Promise<void> {
    const attachments = staffMeta?.attachments?.filter((a) => a.storageKey?.trim()) ?? [];
    const text = fresh.content.trim();
    const onlyGeneratedAttachmentSummary =
      attachments.length > 0 && text.startsWith('Attached:') && text.length < 4096;

    if (text && !onlyGeneratedAttachmentSummary) {
      await this.whatsappCloudApi.sendTextToGuest(conv.propertyId, conv.externalGuestKey ?? undefined, text);
    }

    if (attachments.length === 0) {
      if (!text) {
        throw new Error('WhatsApp staff reply has no text and no attachments');
      }
      return;
    }

    if (!this.storageService.isConfigured()) {
      throw new Error('R2 is required to send WhatsApp media from staff attachments');
    }

    for (const att of attachments) {
      const { buffer, contentType } = await this.storageService.getObjectBuffer(att.storageKey!);
      await this.whatsappCloudApi.sendOneBinaryMediaToGuest(conv.propertyId, conv.externalGuestKey ?? undefined, {
        buffer,
        mimeType: (contentType || att.contentType).trim() || 'application/octet-stream',
        fileName: att.fileName,
      });
    }
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
