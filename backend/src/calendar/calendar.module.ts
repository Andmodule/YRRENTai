import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { BookingEntity } from '../booking/entities/booking.entity';
import { PropertyModule } from '../property/property.module';
import { UserModule } from '../user/user.module';
import { ZodomusModule } from '../integrations/zodomus/zodomus.module';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { CalendarGateway } from './calendar.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([BookingEntity]),
    PropertyModule,
    UserModule,
    JwtModule.register({}),
    forwardRef(() => ZodomusModule),
  ],
  controllers: [CalendarController],
  providers: [CalendarService, CalendarGateway],
  exports: [CalendarGateway, CalendarService],
})
export class CalendarModule {}
