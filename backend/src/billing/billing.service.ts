import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenUsageEntity } from './entities/token-usage.entity';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectRepository(TokenUsageEntity)
    private readonly tokenUsageRepository: Repository<TokenUsageEntity>,
  ) {}

  async recordUsage(
    propertyId: string,
    userId: string,
    tokensUsed: number,
    provider: string,
  ): Promise<TokenUsageEntity> {
    const record = this.tokenUsageRepository.create({
      propertyId,
      userId,
      tokensUsed,
      provider,
    });
    return this.tokenUsageRepository.save(record);
  }

  async getUsage(propertyId: string) {
    const records = await this.tokenUsageRepository.find({
      where: { propertyId },
      order: { createdAt: 'DESC' },
    });
    return { data: records };
  }
}
