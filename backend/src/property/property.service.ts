import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    return this.propertyRepository.save(property);
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
    return this.propertyRepository.save(property);
  }

  async remove(id: string, ownerId: string): Promise<void> {
    const property = await this.findOne(id, ownerId);
    await this.propertyRepository.remove(property);
  }
}
