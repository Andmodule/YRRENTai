import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import type { BookingComMessageMetadata } from '@rentai/shared';
import { ChatMessageEntity, type MessageSource } from './entities/chat-message.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatMessageEntity)
    private readonly messageRepository: Repository<ChatMessageEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * DEV only: removes all inbox rows (conversations, chat_messages), email messaging threads,
   * and escalations. Caller must guard with NODE_ENV !== production.
   */
  async clearAllChatsForDev(): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(`DELETE FROM "escalations"`);
      await manager.query(`DELETE FROM "messaging_threads"`);
      await manager.query(`DELETE FROM "chat_messages"`);
      await manager.query(`DELETE FROM "conversations"`);
    });
  }

  async findMessageById(id: string): Promise<ChatMessageEntity | null> {
    return this.messageRepository.findOne({ where: { id } });
  }

  async saveMessage(data: {
    propertyId: string;
    conversationId?: string;
    userId?: string;
    content: string;
    role: string;
    source?: MessageSource;
    metadata?: BookingComMessageMetadata | null;
  }): Promise<ChatMessageEntity> {
    const message = this.messageRepository.create({ source: 'ai', ...data });
    return this.messageRepository.save(message);
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
    metadata?: BookingComMessageMetadata;
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
      ...(m.metadata ? { metadata: m.metadata } : {}),
      createdAt: m.createdAt.toISOString(),
    };
  }

  async getMessages(propertyId: string, page: number, limit: number, conversationId?: string) {
    const where: FindOptionsWhere<ChatMessageEntity> = conversationId
      ? { propertyId, conversationId }
      : { propertyId };

    const [data, total] = await this.messageRepository.findAndCount({
      where,
      order: { createdAt: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

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
    const data = rows.slice().reverse();
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
