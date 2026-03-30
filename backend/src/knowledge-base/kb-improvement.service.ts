import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EscalationEntity } from '../telegram/entities/escalation.entity';
import { PropertyService } from '../property/property.service';
import { KnowledgeBaseService } from './knowledge-base.service';

export interface KbPendingItemDto {
  id: string;
  propertyId: string;
  propertyName: string;
  guestQuestion: string;
  managerAnswer: string;
  status: 'pending';
  createdAt: string;
}

@Injectable()
export class KbImprovementService {
  constructor(
    @InjectRepository(EscalationEntity)
    private readonly escalationRepository: Repository<EscalationEntity>,
    private readonly propertyService: PropertyService,
    private readonly knowledgeBaseService: KnowledgeBaseService,
  ) {}

  async findPending(
    ownerId: string,
    days: number,
    limit: number,
  ): Promise<{ items: KbPendingItemDto[]; total: number; days: number }> {
    const properties = await this.propertyService.findAllByOwner(ownerId);
    const propertyIds = properties.map((p) => p.id);
    if (propertyIds.length === 0) {
      return { items: [], total: 0, days };
    }

    const since = new Date();
    since.setDate(since.getDate() - days);
    const cappedLimit = Math.min(Math.max(limit, 1), 500);

    const qb = this.escalationRepository
      .createQueryBuilder('e')
      .where('e.propertyId IN (:...propertyIds)', { propertyIds })
      .andWhere('e.staffReply IS NOT NULL')
      .andWhere('e.createdAt > :since', { since })
      .andWhere('(e.kbProcessingStatus IS NULL OR e.kbProcessingStatus = :pending)', {
        pending: 'pending',
      });

    const total = await qb.clone().getCount();

    const rows = await qb
      .orderBy('e.createdAt', 'DESC')
      .take(cappedLimit)
      .getMany();

    const items: KbPendingItemDto[] = rows.map((e) => ({
      id: e.id,
      propertyId: e.propertyId,
      propertyName: e.propertyName,
      guestQuestion: e.guestQuestion,
      managerAnswer: e.staffReply ?? '',
      status: 'pending',
      createdAt: e.createdAt.toISOString(),
    }));

    return { items, total, days };
  }

  async bulkAddToKb(ownerId: string, ids: string[]): Promise<{ added: number }> {
    const unique = [...new Set(ids)].filter(Boolean);
    if (!unique.length) {
      throw new BadRequestException('ids required');
    }

    let added = 0;
    for (const id of unique) {
      const esc = await this.escalationRepository.findOne({ where: { id } });
      if (!esc) throw new NotFoundException(`Escalation ${id} not found`);
      await this.assertEscalationOwned(esc, ownerId);
      if (esc.kbProcessingStatus === 'added_to_kb' || esc.kbProcessingStatus === 'ignored') {
        continue;
      }
      const answer = (esc.staffReply ?? '').trim();
      if (!answer) continue;

      await this.knowledgeBaseService.create(esc.propertyId, {
        title: esc.guestQuestion.slice(0, 200),
        content: answer,
        category: 'other',
      });
      esc.kbProcessingStatus = 'added_to_kb';
      await this.escalationRepository.save(esc);
      added += 1;
    }

    return { added };
  }

  async updatePending(
    ownerId: string,
    id: string,
    body: { guestQuestion?: string; managerAnswer?: string },
  ): Promise<KbPendingItemDto> {
    const hasQ = body.guestQuestion !== undefined;
    const hasA = body.managerAnswer !== undefined;
    if (!hasQ && !hasA) {
      throw new BadRequestException('guestQuestion or managerAnswer required');
    }

    const esc = await this.escalationRepository.findOne({ where: { id } });
    if (!esc) throw new NotFoundException('Escalation not found');
    await this.assertEscalationOwned(esc, ownerId);
    if (esc.kbProcessingStatus === 'added_to_kb' || esc.kbProcessingStatus === 'ignored') {
      throw new BadRequestException('Escalation is no longer editable');
    }

    if (hasQ) {
      const q = body.guestQuestion!.trim();
      if (!q) throw new BadRequestException('guestQuestion cannot be empty');
      esc.guestQuestion = q;
    }
    if (hasA) {
      const a = body.managerAnswer!.trim();
      if (!a) throw new BadRequestException('managerAnswer cannot be empty');
      esc.staffReply = a;
    }

    await this.escalationRepository.save(esc);
    return {
      id: esc.id,
      propertyId: esc.propertyId,
      propertyName: esc.propertyName,
      guestQuestion: esc.guestQuestion,
      managerAnswer: esc.staffReply ?? '',
      status: 'pending',
      createdAt: esc.createdAt.toISOString(),
    };
  }

  async ignore(ownerId: string, id: string): Promise<void> {
    const esc = await this.escalationRepository.findOne({ where: { id } });
    if (!esc) throw new NotFoundException('Escalation not found');
    await this.assertEscalationOwned(esc, ownerId);
    if (esc.kbProcessingStatus === 'added_to_kb') {
      throw new BadRequestException('Already added to knowledge base');
    }
    esc.kbProcessingStatus = 'ignored';
    await this.escalationRepository.save(esc);
  }

  private async assertEscalationOwned(esc: EscalationEntity, ownerId: string): Promise<void> {
    try {
      await this.propertyService.findOne(esc.propertyId, ownerId);
    } catch {
      throw new ForbiddenException('Access denied');
    }
  }
}
