import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskEntity } from './entities/task.entity';
import { TaskNoteEntity } from './entities/task-note.entity';
import { ChecklistTemplateEntity } from './entities/checklist-template.entity';
import { ChecklistTemplateItemEntity } from './entities/checklist-template-item.entity';
import { TaskChecklistItemEntity } from './entities/task-checklist-item.entity';
import { PropertyEntity } from '../property/entities/property.entity';
import { BookingEntity } from '../booking/entities/booking.entity';
import { PropertyModule } from '../property/property.module';
import { TasksController } from './tasks.controller';
import { ChecklistTemplatesController } from './checklist-templates.controller';
import { TasksService } from './tasks.service';
import { ChecklistService } from './checklist.service';
import { TasksGateway } from './tasks.gateway';
import { IncidentsModule } from '../incidents/incidents.module';

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
    ]),
    PropertyModule,
    JwtModule.register({}),
    forwardRef(() => IncidentsModule),
  ],
  controllers: [TasksController, ChecklistTemplatesController],
  providers: [TasksService, TasksGateway, ChecklistService],
  exports: [TasksService, ChecklistService, TasksGateway],
})
export class TasksModule {}
