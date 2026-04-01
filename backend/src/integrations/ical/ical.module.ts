import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingEntity } from '../../booking/entities/booking.entity';
import { PropertyEntity } from '../../property/entities/property.entity';
import { PropertyModule } from '../../property/property.module';
import { ICalSyncService } from './ical-sync.service';
import { ICalCronService } from './ical-cron.service';
import { ICalController } from './ical.controller';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([BookingEntity, PropertyEntity]),
    PropertyModule,
  ],
  controllers: [ICalController],
  providers: [ICalSyncService, ICalCronService],
  exports: [ICalSyncService],
})
export class ICalModule {}
