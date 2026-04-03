import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, QueryFailedError, Repository } from 'typeorm';
import { PropertyEntity } from './entities/property.entity';
import type { CreatePropertyDto, UpdatePropertyDto } from '@rentai/shared';
import { OtaPlatformService } from './ota-platform.service';

@Injectable()
export class PropertyService {
  private readonly logger = new Logger(PropertyService.name);

  constructor(
    @InjectRepository(PropertyEntity)
    private readonly propertyRepository: Repository<PropertyEntity>,
    private readonly otaPlatformService: OtaPlatformService,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreatePropertyDto, ownerId: string): Promise<PropertyEntity> {
    await this.assertOtaPlatformIdValid(dto.otaPlatformId);
    const property = this.propertyRepository.create({ ...dto, ownerId });
    try {
      const saved = await this.propertyRepository.save(property);
      return this.findOne(saved.id, ownerId);
    } catch (e) {
      this.rethrowIfDuplicateZodomusId(e);
      throw e;
    }
  }

  async findAllByOwner(ownerId: string): Promise<PropertyEntity[]> {
    return this.propertyRepository.find({
      where: { ownerId },
      relations: ['otaPlatform'],
      order: { name: 'ASC' },
    });
  }

  /**
   * Match a label from an OTA email (e.g. "Апартаменты на Ленина 12") to one of the owner's listings.
   * Exact normalized match first, then substring containment (either direction).
   */
  async findIdByOwnerAndNameLooseMatch(ownerId: string, nameHint: string): Promise<string | null> {
    const target = this.normalizeListingLabel(nameHint);
    if (!target) return null;
    const props = await this.findAllByOwner(ownerId);
    const norm = (s: string) => this.normalizeListingLabel(s);
    const exact = props.find((p) => norm(p.name) === target);
    if (exact) return exact.id;
    const partial = props.find((p) => {
      const pn = norm(p.name);
      return pn.length >= 3 && (target.includes(pn) || pn.includes(target));
    });
    return partial?.id ?? null;
  }

  private normalizeListingLabel(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFC')
      .replace(/["'`«»\u201c\u201d\u2018\u2019]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Все объекты в системе у которых задан zodomusPropertyId (используется cron-сервисом). */
  async findAllWithZodomus(): Promise<PropertyEntity[]> {
    return this.propertyRepository.find({
      where: { zodomusPropertyId: Not(IsNull()) },
    });
  }

  /** Найти объект по внешнему Zodomus property id (используется webhook-обработчиком). */
  async findByZodomusPropertyId(zodomusPropertyId: string): Promise<PropertyEntity | null> {
    return this.propertyRepository.findOne({ where: { zodomusPropertyId } });
  }

  /** Match external Zodomus listing id for a specific owner (inbound routing). */
  async findIdByZodomusPropertyIdForOwner(
    ownerId: string,
    zodomusPropertyId: string,
  ): Promise<string | null> {
    const z = zodomusPropertyId.trim();
    if (!z) return null;
    const row = await this.propertyRepository.findOne({
      where: { ownerId, zodomusPropertyId: z },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async findOne(id: string, ownerId: string): Promise<PropertyEntity> {
    const property = await this.propertyRepository.findOne({
      where: { id, ownerId },
      relations: ['otaPlatform'],
    });
    if (!property) {
      throw new NotFoundException('Property not found');
    }
    return property;
  }

  /** SUPERADMIN: load any property by id (ownership not checked). */
  async findByIdForAdmin(id: string): Promise<PropertyEntity> {
    const property = await this.propertyRepository.findOne({
      where: { id },
      relations: ['owner'],
    });
    if (!property) {
      throw new NotFoundException('Property not found');
    }
    return property;
  }

  /** SUPERADMIN: all properties with owner email for admin UI. */
  async findAllForAdmin(): Promise<
    Array<{
      id: string;
      name: string;
      zodomusPropertyId: string | null;
      zodomusRoomId: string | null;
      ownerEmail: string | null;
    }>
  > {
    const rows = await this.propertyRepository.find({
      relations: ['owner'],
      order: { name: 'ASC' },
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      zodomusPropertyId: p.zodomusPropertyId,
      zodomusRoomId: p.zodomusRoomId,
      ownerEmail: p.owner?.email ?? null,
    }));
  }

  async update(id: string, dto: UpdatePropertyDto, ownerId: string): Promise<PropertyEntity> {
    await this.assertOtaPlatformIdValid(dto.otaPlatformId);
    const property = await this.findOne(id, ownerId);
    Object.assign(property, dto);
    try {
      await this.propertyRepository.save(property);
      return this.findOne(id, ownerId);
    } catch (e) {
      this.rethrowIfDuplicateZodomusId(e);
      throw e;
    }
  }

  private async assertOtaPlatformIdValid(otaPlatformId: string | null | undefined): Promise<void> {
    if (otaPlatformId === undefined || otaPlatformId === null || otaPlatformId === '') return;
    const plat = await this.otaPlatformService.findByIdOrNull(otaPlatformId);
    if (!plat) {
      throw new BadRequestException('Invalid ota platform id');
    }
  }

  private rethrowIfDuplicateZodomusId(e: unknown): void {
    if (e instanceof QueryFailedError) {
      const err = e.driverError as { code?: string; constraint?: string } | undefined;
      if (err?.code === '23505' && String(err?.constraint ?? '').includes('zodomus')) {
        throw new BadRequestException(
          'This Zodomus property id is already linked to another listing in RentAI.',
        );
      }
    }
  }

  /**
   * Удаляет зависимости без ON DELETE CASCADE, затем сам объект.
   * Иначе PostgreSQL блокирует DELETE по FK (bookings, tasks, …).
   */
  async remove(id: string, ownerId: string): Promise<void> {
    const property = await this.findOne(id, ownerId);
    const pid = property.id;

    await this.dataSource.transaction(async (manager) => {
      await manager.query(`DELETE FROM "token_usage" WHERE "propertyId" = $1`, [pid]);
      await manager.query(`DELETE FROM "bookings" WHERE "propertyId" = $1`, [pid]);
      await manager.query(
        `DELETE FROM "task_notes" WHERE "taskId" IN (SELECT "id" FROM "tasks" WHERE "propertyId" = $1)`,
        [pid],
      );
      await manager.query(`DELETE FROM "tasks" WHERE "propertyId" = $1`, [pid]);
      await manager.query(`DELETE FROM "knowledge_base_entries" WHERE "propertyId" = $1`, [pid]);
      await manager.query(`DELETE FROM "chat_messages" WHERE "propertyId" = $1`, [pid]);
      await manager.query(`DELETE FROM "escalations" WHERE "propertyId" = $1`, [pid]);
      await manager.query(`DELETE FROM "property_notification_settings" WHERE "propertyId" = $1`, [pid]);
      await manager.query(`DELETE FROM "conversations" WHERE "propertyId" = $1`, [pid]);
      await manager.remove(property);
    });
  }
}
