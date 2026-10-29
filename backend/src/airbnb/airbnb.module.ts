import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ZodomusModule } from '../integrations/zodomus/zodomus.module';
import { CalendarDatesModule } from '../calendar-dates/calendar-dates.module';
import { PropertyModule } from '../property/property.module';
import { PropertyChannelListingEntity } from '../property/entities/property-channel-listing.entity';
import { OtaPlatformEntity } from '../property/entities/ota-platform.entity';
import { PricePromotionEntity } from '../pricing/entities/price-promotion.entity';
import { ZodomusAirbnbListingEntity } from './airbnb-listing.entity';
import { AirbnbCalendarService } from './airbnb-calendar.service';
import { AirbnbCalendarController } from './airbnb-calendar.controller';

/**
 * Airbnb through Zodomus — the pilot listing's activation and calendar (ZODOMUS_AIRBNB_ENABLED, off by default).
 * The host connection lives in integrations/zodomus/airbnb. To remove: drop this module from AppModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ZodomusAirbnbListingEntity, PropertyChannelListingEntity, OtaPlatformEntity, PricePromotionEntity]),
    ZodomusModule,
    CalendarDatesModule,
    PropertyModule,
  ],
  controllers: [AirbnbCalendarController],
  providers: [AirbnbCalendarService],
})
export class AirbnbModule {}
