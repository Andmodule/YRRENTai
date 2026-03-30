import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversationEntity } from './entities/conversation.entity';
import type {
  ConversationStatus,
  ConversationChannel,
  ConversationPublicDto,
} from '@rentai/shared';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectRepository(ConversationEntity)
    private readonly repo: Repository<ConversationEntity>,
  ) {}

  async findOrCreate(
    propertyId: string,
    channel: ConversationChannel = 'web_app',
    externalGuestKey?: string,
  ): Promise<ConversationEntity> {
    const existing = await this.repo.findOne({
      where: { propertyId, channel, ...(externalGuestKey ? { externalGuestKey } : {}) },
      order: { lastActivityAt: 'DESC' },
    });

    if (existing && existing.status !== 'resolved') {
      return existing;
    }

    const conv = this.repo.create({
      propertyId,
      channel,
      externalGuestKey,
      status: 'ai_handling',
    });
    return this.repo.save(conv);
  }

  async findById(id: string): Promise<ConversationEntity> {
    const conv = await this.repo.findOne({ where: { id } });
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    return conv;
  }

  async setStatus(id: string, status: ConversationStatus): Promise<ConversationEntity> {
    const conv = await this.findById(id);
    conv.status = status;
    conv.updatedAt = new Date();
    return this.repo.save(conv);
  }

  async touch(id: string, preview?: string): Promise<void> {
    const upd: Partial<ConversationEntity> = { lastActivityAt: new Date() };
    if (preview !== undefined) {
      upd.lastMessagePreview = preview.slice(0, 200);
    }
    await this.repo.update(id, upd);
  }

  async listForOwner(
    ownerId: string,
    filters: { propertyId?: string; status?: ConversationStatus; page: number; limit: number },
  ) {
    const qb = this.repo
      .createQueryBuilder('c')
      .where('c."propertyId" IN (SELECT id FROM properties WHERE "ownerId" = :ownerId)', {
        ownerId,
      });

    if (filters.propertyId) {
      qb.andWhere('c."propertyId" = :pid', { pid: filters.propertyId });
    }
    if (filters.status) {
      qb.andWhere('c.status = :status', { status: filters.status });
    }

    qb.orderBy('c."lastActivityAt"', 'DESC');
    qb.skip((filters.page - 1) * filters.limit).take(filters.limit);

    const [items, total] = await qb.getManyAndCount();

    const propertyNames = await this.resolvePropertyNames(
      items.map((i) => i.propertyId),
    );

    const data: ConversationPublicDto[] = items.map((c) => ({
      id: c.id,
      propertyId: c.propertyId,
      propertyName: propertyNames.get(c.propertyId) ?? '',
      channel: c.channel,
      status: c.status,
      externalGuestKey: c.externalGuestKey ?? null,
      lastMessagePreview: c.lastMessagePreview ?? null,
      lastActivityAt: c.lastActivityAt.toISOString(),
      createdAt: c.createdAt.toISOString(),
    }));

    return {
      data,
      meta: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  private async resolvePropertyNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const unique = [...new Set(ids)];
    const rows: { id: string; name: string }[] = await this.repo.query(
      `SELECT id, name FROM properties WHERE id = ANY($1)`,
      [unique],
    );
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
