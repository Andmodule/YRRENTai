import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatModule } from '../../chat/chat.module';
import { PropertyModule } from '../../property/property.module';
import { TasksModule } from '../../tasks/tasks.module';
import { AutomationRuleEntity } from './entities/automation-rule.entity';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AutomationRuleEntity]),
    PropertyModule,
    TasksModule,
    ChatModule,
  ],
  controllers: [AutomationsController],
  providers: [AutomationsService],
  exports: [AutomationsService],
})
export class AutomationsModule {}
