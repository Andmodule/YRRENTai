import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ZodomusModule } from '../integrations/zodomus/zodomus.module';
import { PropertyModule } from '../property/property.module';
import { PropertyEntity } from '../property/entities/property.entity';
import { PropertyPricingSettingsEntity } from '../pricing/entities/property-pricing-settings.entity';
import { CalendarDatesController } from './calendar-dates.controller';
import { CalendarDatesService } from './calendar-dates.service';
import { CalendarAutoOpenService } from './calendar-auto-open.service';
import { CalendarAutoOpenSettingsEntity } from './entities/calendar-auto-open-settings.entity';

/**
 * «Открыть / закрыть даты на Booking» + «Автопродление календаря».
 * Off unless ZODOMUS_CALENDAR_DATES_ENABLED=true (auto-extension: also ZODOMUS_CALENDAR_AUTO_OPEN_ENABLED).
 * To remove: drop this module from AppModule; nothing else depends on it.
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([PropertyEntity, PropertyPricingSettingsEntity, CalendarAutoOpenSettingsEntity]),
    ZodomusModule,
    PropertyModule,
  ],
  controllers: [CalendarDatesController],
  providers: [CalendarDatesService, CalendarAutoOpenService],
  // «Цены → базовая цена» sends its prices to Booking through the same runs.
  exports: [CalendarDatesService],
})
export class CalendarDatesModule {}
