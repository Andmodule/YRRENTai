import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingEntity } from '../booking/entities/booking.entity';
import { PropertyModule } from '../property/property.module';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

@Module({
  imports: [TypeOrmModule.forFeature([BookingEntity]), PropertyModule],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
