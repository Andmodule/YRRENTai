import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import type { ChatMessageMetadata, ConversationChannel } from '@rentai/shared';
import { staffOutboundMetadataForClient } from '@rentai/shared';
import type {
  ChatMessageSavedChannel,
  ChatMessageSavedEvent,
  ChatMessageSavedSenderRole,
} from '../modules/ai-chat/events/chat-message-saved.event';
import { conversationChannelToMessageChannel } from './chat-channel.mapper';
import { ChatMessageEntity, type MessageSource } from './entities/chat-message.entity';
import { MessageChannel } from './enums/message-channel.enum';
import { MessageDeliveryStatus } from './enums/message-delivery-status.enum';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(ChatMessageEntity)
    private readonly messageRepository: Repository<ChatMessageEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectQueue('ai-intent-extraction')
    private readonly aiIntentExtractionQueue: Queue,
  ) {}

  /**
   * DEV only: removes all inbox rows (conversations, chat_messages), email messaging threads,
   * and escalations. Caller must guard with NODE_ENV !== production.
   */
  async clearAllChatsForDev(): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(`DELETE FROM "escalations"`);
      await manager.query(`DELETE FROM "messaging_threads"`);
      await manager.query(`DELETE FROM "whatsapp_processed_messages"`);
      await manager.query(`DELETE FROM "chat_messages"`);
      await manager.query(`DELETE FROM "conversations"`);
    });
  }

  async findMessageById(id: string): Promise<ChatMessageEntity | null> {
    return this.messageRepository.findOne({ where: { id } });
  }

  /** Strip internal fields (e.g. R2 keys) before WebSocket / API responses. */
  sanitizeMetadataForApi(meta: ChatMessageMetadata | null | undefined): ChatMessageMetadata | undefined {
    if (!meta) return undefined;
    if (meta.channel === 'staff_outbound') {
      return staffOutboundMetadataForClient(meta);
    }
    return meta;
  }

  async saveMessage(data: {
    propertyId: string;
    conversationId?: string;
    userId?: string;
    content: string;
    role: string;
    source?: MessageSource;
    metadata?: ChatMessageMetadata | null;
    channel?: MessageChannel;
    deliveryStatus?: MessageDeliveryStatus;
    /** When set, overrides role→sender mapping for the AI intent extraction job payload. */
    automationSenderRole?: ChatMessageSavedSenderRole;
    /** When true, skips enqueueing AI intent extraction (e.g. automation system lines — avoids LLM feedback loops). */
    skipAutomationEvent?: boolean;
  }): Promise<ChatMessageEntity> {
    const { automationSenderRole, skipAutomationEvent, ...persist } = data;
    const message = this.messageRepository.create({
      ...persist,
      source: data.source ?? 'ai',
      channel: data.channel ?? MessageChannel.BOOKING_API,
      deliveryStatus: data.deliveryStatus ?? MessageDeliveryStatus.SENT,
    });
    const saved = await this.messageRepository.save(message);
    if (!skipAutomationEvent) {
      await this.enqueueAiIntentExtraction(saved, { automationSenderRole });
    }
    return saved;
  }

  private async enqueueAiIntentExtraction(
    m: ChatMessageEntity,
    data: {
      automationSenderRole?: ChatMessageSavedSenderRole | undefined;
    },
  ): Promise<void> {
    try {
      const payload: ChatMessageSavedEvent = {
        messageId: m.id,
        propertyId: m.propertyId,
        senderId: (m.userId?.trim() || m.id) satisfies string,
        senderRole: data.automationSenderRole ?? ChatService.inferAutomationSenderRole(m),
        text: m.content,
        channel: ChatService.messageChannelToSavedChannel(m.channel),
      };
      await this.aiIntentExtractionQueue.add('extract-intent', payload, {
        jobId: payload.messageId,
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`enqueue ai-intent-extraction failed: ${msg}`);
    }
  }

  private static inferAutomationSenderRole(m: ChatMessageEntity): ChatMessageSavedSenderRole {
    if (m.role === 'system') return 'SYSTEM';
    if (m.source === 'staff') return 'STAFF';
    if (m.role === 'user') return 'GUEST';
    return 'MANAGER';
  }

  private static messageChannelToSavedChannel(ch: MessageChannel): ChatMessageSavedChannel {
    switch (ch) {
      case MessageChannel.WHATSAPP:
        return 'whatsapp';
      case MessageChannel.TELEGRAM:
        return 'telegram';
      case MessageChannel.BOOKING_API:
      case MessageChannel.AIRBNB_API:
      case MessageChannel.EMAIL:
        return 'booking';
      default:
        return 'web';
    }
  }

  async resolveOutboundChannel(
    conversationId: string,
    convChannel: ConversationChannel,
  ): Promise<MessageChannel> {
    const lastGuest = await this.messageRepository.findOne({
      where: { conversationId, role: 'user' },
      order: { createdAt: 'DESC' },
    });
    if (lastGuest?.channel) {
      return lastGuest.channel;
    }
    return conversationChannelToMessageChannel(convChannel);
  }

  async saveMessageEntity(m: ChatMessageEntity): Promise<ChatMessageEntity> {
    return this.messageRepository.save(m);
  }

  /**
   * Guest user messages in this thread with the same Booking.com reservation id
   * (excludes the message being inserted — call before save).
   */
  async countPriorBookingComUserMessages(
    conversationId: string,
    bookingNumber: string,
  ): Promise<number> {
    return this.messageRepository
      .createQueryBuilder('m')
      .where('m.conversationId = :cid', { cid: conversationId })
      .andWhere('m.role = :role', { role: 'user' })
      .andWhere(`m.metadata->>'channel' = 'booking_com'`)
      .andWhere(`m.metadata->>'bookingNumber' = :bn`, { bn: bookingNumber })
      .getCount();
  }

  toSocketPayload(m: ChatMessageEntity): {
    id: string;
    propertyId: string;
    conversationId?: string;
    userId: string | null;
    content: string;
    role: string;
    source: MessageSource;
    channel: MessageChannel;
    deliveryStatus: MessageDeliveryStatus;
    metadata?: ChatMessageMetadata;
    createdAt: string;
  } {
    return {
      id: m.id,
      propertyId: m.propertyId,
      conversationId: m.conversationId,
      userId: m.userId ?? null,
      content: m.content,
      role: m.role,
      source: m.source,
      channel: m.channel,
      deliveryStatus: m.deliveryStatus,
      ...(m.metadata ? { metadata: this.sanitizeMetadataForApi(m.metadata)! } : {}),
      createdAt: m.createdAt.toISOString(),
    };
  }

  async getMessages(propertyId: string, page: number, limit: number, conversationId?: string) {
    const where: FindOptionsWhere<ChatMessageEntity> = conversationId
      ? { propertyId, conversationId }
      : { propertyId };

    const [rows, total] = await this.messageRepository.findAndCount({
      where,
      order: { createdAt: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const data = rows.map((m) => ({
      ...m,
      metadata: this.sanitizeMetadataForApi(m.metadata ?? undefined) ?? m.metadata,
    }));

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Last `limit` messages in a conversation, chronological (ASC) — correct for inbox / guest chat UI
   * (preview + body both refer to the “tail” of the thread). Contrasts with page-1 ASC = oldest slice only.
   */
  async getLastMessagesForConversation(
    propertyId: string,
    conversationId: string,
    limit: number,
  ): Promise<{
    data: ChatMessageEntity[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const where: FindOptionsWhere<ChatMessageEntity> = { propertyId, conversationId };
    const total = await this.messageRepository.count({ where });
    const take = Math.min(Math.max(1, limit), 200);
    const rows = await this.messageRepository.find({
      where,
      order: { createdAt: 'DESC' },
      take,
    });
    const data = rows.slice().reverse().map((m) => ({
      ...m,
      metadata: this.sanitizeMetadataForApi(m.metadata ?? undefined) ?? m.metadata,
    }));
    return {
      data,
      meta: { page: 1, limit: take, total, totalPages: 1 },
    };
  }

  async getRecentHistory(
    propertyId: string,
    count = 20,
    conversationId?: string,
  ): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
    const where: FindOptionsWhere<ChatMessageEntity> = conversationId
      ? { propertyId, conversationId }
      : { propertyId };

    const messages = await this.messageRepository.find({
      where,
      order: { createdAt: 'DESC' },
      take: count,
    });

    return messages.reverse().map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
  }

  /** Counts guest-facing assistant replies by source (AI vs staff) for the given properties and time range. */
  async getReplyStats(
    propertyIds: string[],
    from: Date,
    to: Date,
  ): Promise<{ ai: number; staff: number }> {
    if (propertyIds.length === 0) {
      return { ai: 0, staff: 0 };
    }

    const rows = await this.messageRepository
      .createQueryBuilder('m')
      .select('m.source', 'source')
      .addSelect('COUNT(*)', 'cnt')
      .where('m.propertyId IN (:...ids)', { ids: propertyIds })
      .andWhere('m.role = :role', { role: 'assistant' })
      .andWhere('m.createdAt >= :from', { from })
      .andWhere('m.createdAt <= :to', { to })
      .groupBy('m.source')
      .getRawMany<{ source: string; cnt: string }>();

    let ai = 0;
    let staff = 0;
    for (const row of rows) {
      const n = Number(row.cnt);
      if (row.source === 'ai') ai = n;
      else if (row.source === 'staff') staff = n;
    }
    return { ai, staff };
  }
}
