import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { BookingEntity } from './entities/booking.entity';
import { PropertyModule } from '../property/property.module';
import { ZodomusModule } from '../integrations/zodomus/zodomus.module';
import { GuestModule } from '../guest/guest.module';

@Module({
  imports: [TypeOrmModule.forFeature([BookingEntity]), PropertyModule, ZodomusModule, GuestModule],
  controllers: [BookingController],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingModule {}
