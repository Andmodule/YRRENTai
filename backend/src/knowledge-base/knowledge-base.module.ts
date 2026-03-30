import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeBaseImportController } from './knowledge-base-import.controller';
import { KnowledgeBaseImportService } from './knowledge-base-import.service';
import { KnowledgeBaseEntryEntity } from './entities/knowledge-base-entry.entity';
import { EmbeddingModule } from '../embedding/embedding.module';
import { PropertyModule } from '../property/property.module';
import { EscalationEntity } from '../telegram/entities/escalation.entity';
import { KbController } from './kb.controller';
import { KbImprovementService } from './kb-improvement.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeBaseEntryEntity, EscalationEntity]),
    MulterModule.register({ storage: undefined }),
    EmbeddingModule,
    PropertyModule,
  ],
  controllers: [KnowledgeBaseController, KnowledgeBaseImportController, KbController],
  providers: [KnowledgeBaseService, KnowledgeBaseImportService, KbImprovementService],
  exports: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
