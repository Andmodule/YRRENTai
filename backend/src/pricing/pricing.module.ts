import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ZodomusModule } from '../integrations/zodomus/zodomus.module';
import { PropertyModule } from '../property/property.module';
import { UserModule } from '../user/user.module';
import { PricingConfig } from './pricing-config';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';
import { PricingRulesController } from './pricing-rules.controller';
import { PricingRulesService } from './pricing-rules.service';
import { PricingOccupancyController } from './pricing-occupancy.controller';
import { PricingOccupancyService } from './pricing-occupancy.service';
import { BookingEntity } from '../booking/entities/booking.entity';
import { PricingOccupancySettingsEntity } from './entities/pricing-occupancy-settings.entity';
import { PromotionExecutorService } from './promotion-executor.service';
import { PromotionQueueService } from './promotion-queue.service';
import { PromotionSyncService } from './promotion-sync.service';
import { PricePromotionEntity } from './entities/price-promotion.entity';
import { PricePromotionTargetEntity } from './entities/price-promotion-target.entity';
import { PricePromotionEventEntity } from './entities/price-promotion-event.entity';
import { PropertyPricingSettingsEntity } from './entities/property-pricing-settings.entity';
import { PricingGuestPriceController } from './pricing-guest-price.controller';
import { PricingGuestPriceService } from './pricing-guest-price.service';
import { PropertyChannelProfileEntity } from './entities/property-channel-profile.entity';
import { PropertyChannelNightPriceEntity } from './entities/property-channel-night-price.entity';
import { PriceObservationEntity } from './entities/price-observation.entity';
import { PricingBasePriceController } from './pricing-base-price.controller';
import { PricingBasePriceService } from './pricing-base-price.service';
import { PropertyBasePriceEntity } from './entities/property-base-price.entity';
import { PropertyChannelPricingEntity } from './entities/property-channel-pricing.entity';
import { CalendarDatesModule } from '../calendar-dates/calendar-dates.module';

/**
 * «Цены»: Booking.com promotions via Zodomus + minimum price protection.
 * Off unless ZODOMUS_PROMOTIONS_ENABLED=true; writes to Booking also need ZODOMUS_PROMOTIONS_DRY_RUN=false.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PricePromotionEntity,
      PricePromotionTargetEntity,
      PricePromotionEventEntity,
      PropertyPricingSettingsEntity,
      PricingOccupancySettingsEntity,
      PropertyChannelProfileEntity,
      PropertyChannelNightPriceEntity,
      PriceObservationEntity,
      PropertyBasePriceEntity,
      PropertyChannelPricingEntity,
      // read-only here: booked nights for «Заполненность»
      BookingEntity,
    ]),
    ZodomusModule,
    PropertyModule,
    UserModule,
    // «Отправить в Booking» of the base price runs through «Открыть / закрыть даты».
    CalendarDatesModule,
  ],
  controllers: [
    PricingController,
    PricingRulesController,
    PricingOccupancyController,
    PricingGuestPriceController,
    PricingBasePriceController,
  ],
  providers: [
    PricingConfig,
    PromotionExecutorService,
    PromotionQueueService,
    PromotionSyncService,
    PricingService,
    PricingRulesService,
    PricingOccupancyService,
    PricingGuestPriceService,
    PricingBasePriceService,
  ],
})
export class PricingModule {}
