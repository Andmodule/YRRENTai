import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OtaPlatformEntity } from './entities/ota-platform.entity';

@Injectable()
export class OtaPlatformService {
  constructor(
    @InjectRepository(OtaPlatformEntity)
    private readonly repo: Repository<OtaPlatformEntity>,
  ) {}

  findAll(): Promise<OtaPlatformEntity[]> {
    return this.repo.find({ order: { sortOrder: 'ASC' } });
  }

  async findByIdOrNull(id: string): Promise<OtaPlatformEntity | null> {
    return this.repo.findOne({ where: { id } });
  }
}
