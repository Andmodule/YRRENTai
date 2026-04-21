import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PropertyModule } from '../../property/property.module';
import { AutomationRuleEntity } from '../automations/entities/automation-rule.entity';
import { AiExtractorService } from './ai-extractor.service';
import { AiIntentTestController } from './ai-intent-test.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([AutomationRuleEntity]),
    PropertyModule,
    BullModule.registerQueue({
      name: 'ai-intent-extraction',
    }),
  ],
  controllers: [AiIntentTestController],
  providers: [AiExtractorService],
  exports: [BullModule],
})
export class AiChatModule {}
