import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { VoiceAuditLogEntity, AuditActionType } from './entities/voice-audit-log.entity';

export interface AuditLogFilters {
  actionType?: AuditActionType;
  actorId?: string;
  propertyId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface LogAuditDto {
  actorId: string;
  actorRole: string;
  actionType: AuditActionType;
  entityType?: string;
  entityId?: string;
  propertyId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class VoiceAuditService {
  constructor(
    @InjectRepository(VoiceAuditLogEntity)
    private readonly repo: Repository<VoiceAuditLogEntity>,
  ) {}

  async log(dto: LogAuditDto): Promise<void> {
    await this.repo.insert({
      actorId: dto.actorId,
      actorRole: dto.actorRole,
      actionType: dto.actionType,
      entityType: dto.entityType ?? null,
      entityId: dto.entityId ?? null,
      propertyId: dto.propertyId ?? null,
      metadata: (dto.metadata ?? {}) as any,
    });
  }

  async getAuditLog(filters: AuditLogFilters): Promise<{
    items: VoiceAuditLogEntity[];
    total: number;
  }> {
    const page = filters.page ?? 0;
    const pageSize = Math.min(filters.pageSize ?? 50, 200);

    const qb = this.repo
      .createQueryBuilder('log')
      .orderBy('log.createdAt', 'DESC')
      .take(pageSize)
      .skip(page * pageSize);

    if (filters.actionType) qb.andWhere('log.actionType = :at', { at: filters.actionType });
    if (filters.actorId) qb.andWhere('log.actorId = :aid', { aid: filters.actorId });
    if (filters.propertyId) qb.andWhere('log.propertyId = :pid', { pid: filters.propertyId });
    if (filters.dateFrom) qb.andWhere('log.createdAt >= :df', { df: new Date(filters.dateFrom) });
    if (filters.dateTo) qb.andWhere('log.createdAt <= :dt', { dt: new Date(filters.dateTo) });

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }
}
