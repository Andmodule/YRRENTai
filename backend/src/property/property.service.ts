import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, QueryFailedError, Repository } from 'typeorm';
import { PropertyEntity } from './entities/property.entity';
import type { CreatePropertyDto, UpdatePropertyDto } from '@rentai/shared';

@Injectable()
export class PropertyService {
  private readonly logger = new Logger(PropertyService.name);

  constructor(
    @InjectRepository(PropertyEntity)
    private readonly propertyRepository: Repository<PropertyEntity>,
  ) {}

  async create(dto: CreatePropertyDto, ownerId: string): Promise<PropertyEntity> {
    const property = this.propertyRepository.create({ ...dto, ownerId });
    try {
      return await this.propertyRepository.save(property);
    } catch (e) {
      this.rethrowIfDuplicateZodomusId(e);
      throw e;
    }
  }

  async findAllByOwner(ownerId: string): Promise<PropertyEntity[]> {
    return this.propertyRepository.find({ where: { ownerId } });
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
    const property = await this.propertyRepository.findOne({ where: { id, ownerId } });
    if (!property) {
      throw new NotFoundException('Property not found');
    }
    return property;
  }

  async update(id: string, dto: UpdatePropertyDto, ownerId: string): Promise<PropertyEntity> {
    const property = await this.findOne(id, ownerId);
    Object.assign(property, dto);
    try {
      return await this.propertyRepository.save(property);
    } catch (e) {
      this.rethrowIfDuplicateZodomusId(e);
      throw e;
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

  async remove(id: string, ownerId: string): Promise<void> {
    const property = await this.findOne(id, ownerId);
    await this.propertyRepository.remove(property);
  }
}
