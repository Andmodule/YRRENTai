import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskEntity } from './entities/task.entity';
import { TaskNoteEntity } from './entities/task-note.entity';
import { ChecklistTemplateEntity } from './entities/checklist-template.entity';
import { ChecklistTemplateItemEntity } from './entities/checklist-template-item.entity';
import { TaskChecklistItemEntity } from './entities/task-checklist-item.entity';
import { PropertyEntity } from '../property/entities/property.entity';
import { UserEntity } from '../user/entities/user.entity';
import { StaffDailyDigestSentEntity } from './entities/staff-daily-digest-sent.entity';
import { BookingEntity } from '../booking/entities/booking.entity';
import { IncidentEntity } from '../incidents/entities/incident.entity';
import { PropertyModule } from '../property/property.module';
import { TasksController } from './tasks.controller';
import { ChecklistTemplatesController } from './checklist-templates.controller';
import { TasksService } from './tasks.service';
import { ChecklistService } from './checklist.service';
import { TasksGateway } from './tasks.gateway';
import { TasksDigestSchedulerService } from './tasks-digest.scheduler';
import { IncidentsModule } from '../incidents/incidents.module';
import { UserModule } from '../user/user.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TaskEntity,
      TaskNoteEntity,
      ChecklistTemplateEntity,
      ChecklistTemplateItemEntity,
      TaskChecklistItemEntity,
      PropertyEntity,
      BookingEntity,
      IncidentEntity,
      StaffDailyDigestSentEntity,
      UserEntity,
    ]),
    PropertyModule,
    UserModule,
    JwtModule.register({}),
    forwardRef(() => IncidentsModule),
    forwardRef(() => TelegramModule),
  ],
  controllers: [TasksController, ChecklistTemplatesController],
  providers: [TasksService, TasksGateway, ChecklistService, TasksDigestSchedulerService],
  exports: [TasksService, ChecklistService, TasksGateway],
})
export class TasksModule {}
