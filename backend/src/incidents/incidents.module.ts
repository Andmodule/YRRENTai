import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IncidentEntity } from './entities/incident.entity';
import { IncidentsService } from './incidents.service';
import { IncidentsController } from './incidents.controller';
import { TaskEntity } from '../tasks/entities/task.entity';
import { PropertyEntity } from '../property/entities/property.entity';
import { BookingEntity } from '../booking/entities/booking.entity';
import { TelegramModule } from '../telegram/telegram.module';
import { TasksModule } from '../tasks/tasks.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([IncidentEntity, TaskEntity, PropertyEntity, BookingEntity]),
    forwardRef(() => TelegramModule),
    forwardRef(() => TasksModule),
    UserModule,
  ],
  controllers: [IncidentsController],
  providers: [IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
