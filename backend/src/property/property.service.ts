import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, QueryFailedError, Repository } from 'typeorm';
import { PropertyEntity } from './entities/property.entity';
import { PropertyChannelListingEntity } from './entities/property-channel-listing.entity';
import type { CreatePropertyDto, UpdatePropertyDto, ZodomusPropertyStatus } from '@rentai/shared';
import { OtaPlatformService } from './ota-platform.service';
import { UserService } from '../user/user.service';

@Injectable()
export class PropertyService {
  constructor(
    @InjectRepository(PropertyEntity)
    private readonly propertyRepository: Repository<PropertyEntity>,
    @InjectRepository(PropertyChannelListingEntity)
    private readonly channelListingRepository: Repository<PropertyChannelListingEntity>,
    private readonly otaPlatformService: OtaPlatformService,
    private readonly dataSource: DataSource,
    private readonly userService: UserService,
  ) {}

  async create(dto: CreatePropertyDto, ownerId: string): Promise<PropertyEntity> {
    const channelListings = dto.channelListings ?? [];
    await this.assertChannelListingsPlatformsValid(channelListings);
    const owner = await this.userService.findById(ownerId);
    if (!owner?.companyId) {
      throw new BadRequestException('Owner company not found');
    }
    const property = this.propertyRepository.create({
      name: dto.name,
      country: dto.country,
      city: dto.city,
      address: dto.address,
      description: dto.description,
      timezone: dto.timezone,
      currency: dto.currency ?? 'USD',
      maxGuests: dto.maxGuests,
      icalImportUrls: dto.icalImportUrls ?? [],
      whatsappPhoneNumberId: dto.whatsappPhoneNumberId ?? null,
      whatsappAccessToken: dto.whatsappAccessToken ?? null,
      ownerId,
      companyId: owner.companyId,
    });
    try {
      const saved = await this.propertyRepository.save(property);
      await this.replaceChannelListings(saved.id, channelListings);
      await this.syncLegacyColumnsFromListings(saved.id, {
        manualZodomusPropertyId:
          channelListings.length === 0
            ? (dto.zodomusPropertyId !== undefined ? dto.zodomusPropertyId : null)
            : undefined,
      });
      return this.findOne(saved.id, ownerId);
    } catch (e) {
      this.rethrowIfDuplicateExternalListingId(e);
      throw e;
    }
  }

  async findAllByOwner(ownerId: string): Promise<PropertyEntity[]> {
    return this.propertyRepository.find({
      where: { ownerId },
      relations: ['otaPlatform', 'channelListings', 'channelListings.otaPlatform'],
      order: { name: 'ASC' },
    });
  }

  async findAllForCompany(companyId: string): Promise<PropertyEntity[]> {
    return this.propertyRepository.find({
      where: { companyId },
      select: { id: true, name: true },
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

  /** Все объекты с хотя бы одним внешним id Zodomus (cron / очередь). */
  async findAllWithZodomus(): Promise<PropertyEntity[]> {
    return this.propertyRepository
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.channelListings', 'cl')
      .leftJoinAndSelect('cl.otaPlatform', 'clp')
      .leftJoinAndSelect('p.otaPlatform', 'op')
      .where(
        new Brackets((qb) =>
          qb.where('p.zodomusPropertyId IS NOT NULL').orWhere(
            'EXISTS (SELECT 1 FROM property_channel_listings pcl WHERE pcl."propertyId" = p.id)',
          ),
        ),
      )
      .getMany();
  }

  /** Persist last known Zodomus listing status (CRM badge / diagnostics). */
  async setZodomusStatus(
    propertyId: string,
    status: ZodomusPropertyStatus | null,
    detail: string | null = null,
  ): Promise<void> {
    await this.propertyRepository.update(propertyId, {
      zodomusStatus: status,
      zodomusStatusDetail: detail?.trim() ? detail.trim().slice(0, 2000) : null,
      zodomusStatusCheckedAt: status == null ? null : new Date(),
    });
  }

  /** Найти объект по внешнему id в Zodomus (webhook). */
  async findByZodomusPropertyId(zodomusPropertyId: string): Promise<PropertyEntity | null> {
    const z = zodomusPropertyId.trim();
    if (!z) return null;
    const listing = await this.channelListingRepository.findOne({
      where: { externalListingId: z },
      select: { propertyId: true },
    });
    if (listing?.propertyId) {
      return this.propertyRepository.findOne({
        where: { id: listing.propertyId },
        relations: ['channelListings', 'channelListings.otaPlatform', 'otaPlatform'],
      });
    }
    return this.propertyRepository.findOne({
      where: { zodomusPropertyId: z },
      relations: ['channelListings', 'channelListings.otaPlatform', 'otaPlatform'],
    });
  }

  /** Match external Zodomus listing id for a specific owner (inbound routing). */
  async findIdByZodomusPropertyIdForOwner(
    ownerId: string,
    zodomusPropertyId: string,
  ): Promise<string | null> {
    const z = zodomusPropertyId.trim();
    if (!z) return null;
    const byListing = await this.channelListingRepository
      .createQueryBuilder('cl')
      .innerJoinAndSelect('cl.property', 'p')
      .where('cl.externalListingId = :z', { z })
      .andWhere('p.ownerId = :ownerId', { ownerId })
      .getOne();
    if (byListing?.property) return byListing.property.id;
    const row = await this.propertyRepository.findOne({
      where: { ownerId, zodomusPropertyId: z },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /** For messaging / webhooks — resolve owner without requiring caller's user id. */
  async getOwnerIdByPropertyId(propertyId: string): Promise<string | null> {
    const row = await this.propertyRepository.findOne({
      where: { id: propertyId },
      select: ['ownerId'],
    });
    return row?.ownerId ?? null;
  }

  /**
   * Внешний id объекта в Zodomus для данного numeric channel id (Booking=1, Airbnb=3, …).
   */
  getExternalListingIdForZodomusChannel(property: PropertyEntity, zodomusChannelId: number): string | null {
    const listings = property.channelListings ?? [];
    for (const row of listings) {
      const ch = row.otaPlatform?.zodomusChannelId;
      if (ch === zodomusChannelId) {
        const ext = row.externalListingId?.trim();
        if (ext) return ext;
      }
    }
    if (listings.length === 0) {
      const only = property.zodomusPropertyId?.trim();
      if (only) return only;
      return null;
    }
    if (property.otaPlatform?.zodomusChannelId === zodomusChannelId) {
      const leg = property.zodomusPropertyId?.trim();
      if (leg) return leg;
    }
    return null;
  }

  /** Internal: load property by id without ownership (webhooks / outbound delivery). */
  async findByIdBare(id: string): Promise<PropertyEntity | null> {
    return this.propertyRepository.findOne({
      where: { id },
      relations: ['channelListings', 'channelListings.otaPlatform', 'otaPlatform'],
    });
  }

  /** Resolve property by Meta WhatsApp Phone number id (webhook routing). */
  async findByWhatsappPhoneNumberId(phoneNumberId: string): Promise<PropertyEntity | null> {
    const t = phoneNumberId.trim();
    if (!t) return null;
    return this.propertyRepository.findOne({
      where: { whatsappPhoneNumberId: t },
    });
  }

  async findOne(id: string, ownerId: string): Promise<PropertyEntity> {
    const property = await this.propertyRepository.findOne({
      where: { id, ownerId },
      relations: ['otaPlatform', 'channelListings', 'channelListings.otaPlatform'],
    });
    if (!property) {
      throw new NotFoundException('Property not found');
    }
    this.sortChannelListingsInPlace(property);
    return property;
  }

  /** Resolves tenant owner for OWNER/MANAGER; SUPERADMIN sees any property. */
  async findOneForUser(id: string, userId: string, role: string): Promise<PropertyEntity> {
    if (role === 'SUPERADMIN') {
      return this.findByIdForAdmin(id);
    }
    const ownerId = await this.userService.resolveTenantOwnerId(userId, role);
    return this.findOne(id, ownerId);
  }

  /** SUPERADMIN: load any property by id (ownership not checked). */
  async findByIdForAdmin(id: string): Promise<PropertyEntity> {
    const property = await this.propertyRepository.findOne({
      where: { id },
      relations: ['owner', 'channelListings', 'channelListings.otaPlatform', 'otaPlatform'],
    });
    if (!property) {
      throw new NotFoundException('Property not found');
    }
    this.sortChannelListingsInPlace(property);
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
    const property = await this.findOne(id, ownerId);
    if (dto.channelListings !== undefined) {
      await this.assertChannelListingsPlatformsValid(dto.channelListings);
      await this.replaceChannelListings(id, dto.channelListings);
      // Не оставляем `channelListings` из findOne (устаревшие) и не ставим `[]`: у TypeORM
      // persist по родителю пустой OneToMany может снять строки `property_channel_listings` в БД
      // после replace — тогда Zodomus/доступность не видит каналов, отмена не отражается в OTA.
      const fresh = await this.channelListingRepository.find({
        where: { propertyId: id },
        relations: ['otaPlatform'],
        order: { sortOrder: 'ASC' },
      });
      property.channelListings = fresh;
    }
    const {
      channelListings: _cl,
      zodomusPropertyId: manualZodomus,
      whatsappAccessToken: waToken,
      ...scalar
    } = dto;
    for (const key of Object.keys(scalar) as Array<keyof typeof scalar>) {
      const v = scalar[key];
      if (v !== undefined) {
        (property as unknown as Record<string, unknown>)[key as string] = v as unknown;
      }
    }
    if (waToken !== undefined) {
      property.whatsappAccessToken = waToken?.trim() ? waToken.trim() : null;
    }
    if (dto.channelListings !== undefined && dto.channelListings.length === 0) {
      const nextZ =
        manualZodomus !== undefined
          ? (manualZodomus?.trim() ? manualZodomus.trim() : null)
          : null;
      property.otaPlatformId = null;
      property.otaPlatform = null;
      property.zodomusPropertyId = nextZ;
      property.zodomusRoomId = null;
    }
    try {
      await this.propertyRepository.save(property);
      if (dto.channelListings !== undefined) {
        await this.syncLegacyColumnsFromListings(id, {
          /** Пустой массив = явное удаление всех каналов; без поля `zodomusPropertyId` в DTO очищаем legacy, а не оставляем старый id. */
          manualZodomusPropertyId:
            dto.channelListings.length === 0
              ? (manualZodomus !== undefined ? manualZodomus : null)
              : undefined,
        });
      } else if (manualZodomus !== undefined) {
        const count = await this.channelListingRepository.count({ where: { propertyId: id } });
        if (count === 0) {
          await this.propertyRepository.update(id, {
            zodomusPropertyId: manualZodomus?.trim() ? manualZodomus.trim() : null,
          });
        }
      }
      return this.findOne(id, ownerId);
    } catch (e) {
      this.rethrowIfDuplicateExternalListingId(e);
      throw e;
    }
  }

  private sortChannelListingsInPlace(property: PropertyEntity): void {
    if (!property.channelListings?.length) return;
    property.channelListings.sort((a, b) => {
      const ao = a.otaPlatform?.sortOrder ?? 0;
      const bo = b.otaPlatform?.sortOrder ?? 0;
      if (ao !== bo) return ao - bo;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });
  }

  private async assertChannelListingsPlatformsValid(
    rows: Array<{ otaPlatformId: string }>,
  ): Promise<void> {
    for (const row of rows) {
      const plat = await this.otaPlatformService.findByIdOrNull(row.otaPlatformId);
      if (!plat) {
        throw new BadRequestException('Invalid ota platform id');
      }
    }
  }

  private async replaceChannelListings(
    propertyId: string,
    rows: Array<{ otaPlatformId: string; externalListingId: string; zodomusRoomId?: string | null }>,
  ): Promise<void> {
    await this.channelListingRepository.delete({ propertyId });
    let i = 0;
    for (const row of rows) {
      const ext = row.externalListingId.trim();
      const room = row.zodomusRoomId?.trim() ? row.zodomusRoomId.trim() : null;
      await this.channelListingRepository.save({
        propertyId,
        otaPlatformId: row.otaPlatformId,
        externalListingId: ext,
        zodomusRoomId: room,
        sortOrder: i++,
      });
    }
  }

  /** Дублирует первый канал в legacy-колонки `properties` для совместимости. */
  private async syncLegacyColumnsFromListings(
    propertyId: string,
    options?: { manualZodomusPropertyId?: string | null },
  ): Promise<void> {
    const listings = await this.channelListingRepository.find({
      where: { propertyId },
      relations: ['otaPlatform'],
      order: { sortOrder: 'ASC' },
    });
    const first = listings[0];
    if (!first) {
      let nextZ: string | null;
      if (options?.manualZodomusPropertyId !== undefined) {
        nextZ = options.manualZodomusPropertyId?.trim() ? options.manualZodomusPropertyId.trim() : null;
      } else {
        const cur = await this.propertyRepository.findOne({
          where: { id: propertyId },
          select: { zodomusPropertyId: true },
        });
        nextZ = cur?.zodomusPropertyId ?? null;
      }
      await this.propertyRepository.update(propertyId, {
        otaPlatformId: null,
        zodomusPropertyId: nextZ,
        zodomusRoomId: null,
        ...(nextZ
          ? {}
          : {
              zodomusStatus: null,
              zodomusStatusDetail: null,
              zodomusStatusCheckedAt: null,
            }),
      });
      return;
    }
    await this.propertyRepository.update(propertyId, {
      otaPlatformId: first.otaPlatformId,
      zodomusPropertyId: first.externalListingId.trim(),
      zodomusRoomId: first.zodomusRoomId?.trim() ? first.zodomusRoomId.trim() : null,
    });
  }

  private rethrowIfDuplicateExternalListingId(e: unknown): void {
    if (e instanceof QueryFailedError) {
      const err = e.driverError as {
        code?: string;
        constraint?: string;
        detail?: string;
        message?: string;
      } | undefined;
      if (err?.code === '23505') {
        const hay = `${err.constraint ?? ''} ${err.detail ?? ''} ${err.message ?? ''}`.toLowerCase();
        if (
          hay.includes('externallistingid') ||
          hay.includes('zodomuspropertyid') ||
          hay.includes('zodomus') ||
          hay.includes('uq_property_channel_listings') ||
          hay.includes('uq_properties_zodomus')
        ) {
          throw new BadRequestException(
            'This external listing id is already linked to another property in RentAI.',
          );
        }
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
      await manager.query(`DELETE FROM "conversations" WHERE "propertyId" = $1`, [pid]);
      await manager.remove(property);
    });
  }
}
