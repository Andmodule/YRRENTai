import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeBaseImportController } from './knowledge-base-import.controller';
import { KnowledgeBaseImportService } from './knowledge-base-import.service';
import { KnowledgeBaseEntryEntity } from './entities/knowledge-base-entry.entity';
import { EmbeddingModule } from '../embedding/embedding.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeBaseEntryEntity]),
    MulterModule.register({ storage: undefined }),
    EmbeddingModule,
  ],
  controllers: [KnowledgeBaseController, KnowledgeBaseImportController],
  providers: [KnowledgeBaseService, KnowledgeBaseImportService],
  exports: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
