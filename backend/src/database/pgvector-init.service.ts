import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class PgVectorInitService implements OnModuleInit {
  private readonly logger = new Logger(PgVectorInitService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit() {
    try {
      await this.dataSource.query('CREATE EXTENSION IF NOT EXISTS vector');
      this.logger.log('pgvector extension ready');
    } catch (err) {
      this.logger.warn(`pgvector init skipped: ${(err as Error).message}`);
    }
  }
}
