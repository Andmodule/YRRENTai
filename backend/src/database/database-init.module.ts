import { Module } from '@nestjs/common';
import { PgVectorInitService } from './pgvector-init.service';

@Module({
  providers: [PgVectorInitService],
})
export class DatabaseInitModule {}
