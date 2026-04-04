import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import { InboundEmailDedupEntity } from './entities/inbound-email-dedup.entity';

const PROVIDER_RESEND = 'resend';

@Injectable()
export class InboundEmailDedupService {
  constructor(
    @InjectRepository(InboundEmailDedupEntity)
    private readonly repo: Repository<InboundEmailDedupEntity>,
  ) {}

  /**
   * @returns true if a new row was inserted; false if (provider, externalId) already existed.
   */
  async tryInsertResendEvent(externalId: string): Promise<boolean> {
    const ext = externalId.trim();
    if (!ext) return true;
    try {
      await this.repo.insert({
        provider: PROVIDER_RESEND,
        externalId: ext,
      });
      return true;
    } catch (e) {
      if (e instanceof QueryFailedError) {
        const code = (e as QueryFailedError & { driverError?: { code?: string } }).driverError?.code;
        if (code === '23505') return false;
      }
      throw e;
    }
  }

  async deleteResendEvent(externalId: string): Promise<void> {
    const ext = externalId.trim();
    if (!ext) return;
    await this.repo.delete({ provider: PROVIDER_RESEND, externalId: ext });
  }
}
