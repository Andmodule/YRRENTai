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
import { PromotionExecutorService } from './promotion-executor.service';
import { PromotionQueueService } from './promotion-queue.service';
import { PromotionSyncService } from './promotion-sync.service';
import { PricePromotionEntity } from './entities/price-promotion.entity';
import { PricePromotionTargetEntity } from './entities/price-promotion-target.entity';
import { PricePromotionEventEntity } from './entities/price-promotion-event.entity';
import { PropertyPricingSettingsEntity } from './entities/property-pricing-settings.entity';

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
    ]),
    ZodomusModule,
    PropertyModule,
    UserModule,
  ],
  controllers: [PricingController, PricingRulesController],
  providers: [
    PricingConfig,
    PromotionExecutorService,
    PromotionQueueService,
    PromotionSyncService,
    PricingService,
    PricingRulesService,
  ],
})
export class PricingModule {}
