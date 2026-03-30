import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatMessageEntity, type MessageSource } from './entities/chat-message.entity';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(ChatMessageEntity)
    private readonly messageRepository: Repository<ChatMessageEntity>,
  ) {}

  async saveMessage(data: {
    propertyId: string;
    userId?: string;
    content: string;
    role: string;
    source?: MessageSource;
  }): Promise<ChatMessageEntity> {
    const message = this.messageRepository.create({ source: 'ai', ...data });
    return this.messageRepository.save(message);
  }

  async getMessages(propertyId: string, page: number, limit: number) {
    const [data, total] = await this.messageRepository.findAndCount({
      where: { propertyId },
      order: { createdAt: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getRecentHistory(
    propertyId: string,
    count = 20,
  ): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
    const messages = await this.messageRepository.find({
      where: { propertyId },
      order: { createdAt: 'DESC' },
      take: count,
    });

    return messages.reverse().map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
  }
}
