import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
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
