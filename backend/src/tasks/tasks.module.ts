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
import { CompanyEntity } from '../user/entities/company.entity';
import { StaffDailyDigestSentEntity } from './entities/staff-daily-digest-sent.entity';
import { BookingEntity } from '../booking/entities/booking.entity';
import { IncidentEntity } from '../incidents/entities/incident.entity';
import { StaffInterpretationEventEntity } from './entities/staff-interpretation-event.entity';
import { SupplyRequestItemEntity } from './entities/supply-request-item.entity';
import { SupplyItemEntity } from './entities/supply-item.entity';
import { CatalogSeedSuppressionEntity } from './entities/catalog-seed-suppression.entity';
import { SupplyItemAliasEntity } from './entities/supply-item-alias.entity';
import { DeliveryRouteEntity } from './entities/delivery-route.entity';
import { DeliveryRouteStopEntity } from './entities/delivery-route-stop.entity';
import { DeliveryStopSupplyLineEntity } from './entities/delivery-stop-supply-line.entity';
import { DeliveryRoutesService } from './delivery-routes.service';
import { StaffInterpretationService } from './staff-interpretation.service';
import { SupplyCatalogService } from './supply-catalog.service';
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
      StaffInterpretationEventEntity,
      SupplyRequestItemEntity,
      SupplyItemEntity,
      CatalogSeedSuppressionEntity,
      SupplyItemAliasEntity,
      DeliveryRouteEntity,
      DeliveryRouteStopEntity,
      DeliveryStopSupplyLineEntity,
      CompanyEntity,
    ]),
    PropertyModule,
    UserModule,
    JwtModule.register({}),
    forwardRef(() => IncidentsModule),
    forwardRef(() => TelegramModule),
  ],
  controllers: [TasksController, ChecklistTemplatesController],
  providers: [
    TasksService,
    StaffInterpretationService,
    SupplyCatalogService,
    DeliveryRoutesService,
    TasksGateway,
    ChecklistService,
    TasksDigestSchedulerService,
  ],
  exports: [
    TasksService,
    StaffInterpretationService,
    SupplyCatalogService,
    DeliveryRoutesService,
    ChecklistService,
    TasksGateway,
  ],
})
export class TasksModule {}
