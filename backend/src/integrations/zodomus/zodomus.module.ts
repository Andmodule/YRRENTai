import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ZODOMUS_CLIENT } from './zodomus.tokens';
import { ZodomusClient } from './zodomus.client';
import { ZodomusService } from './zodomus.service';
import { ZodomusSyncService } from './zodomus-sync.service';
import { ZodomusCronService } from './zodomus-cron.service';
import { ZodomusController } from './zodomus.controller';
import { ZodomusWebhookController } from './zodomus-webhook.controller';
import { ZodomusAdminController } from './zodomus-admin.controller';
import { ZodomusApiRefController } from './zodomus-api-ref.controller';
import { BookingEntity } from '../../booking/entities/booking.entity';
import { PropertyEntity } from '../../property/entities/property.entity';
import { PropertyChannelListingEntity } from '../../property/entities/property-channel-listing.entity';
import { PropertyModule } from '../../property/property.module';
import { UserModule } from '../../user/user.module';
import { CalendarModule } from '../../calendar/calendar.module';
import { GuestModule } from '../../guest/guest.module';
import { ZodomusAvailabilityPushService } from './zodomus-availability-push.service';
import { ZodomusMappingService } from './zodomus-mapping.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([BookingEntity, PropertyEntity, PropertyChannelListingEntity]),
    PropertyModule,
    UserModule,
    forwardRef(() => CalendarModule),
    GuestModule,
  ],
  controllers: [
    ZodomusController,
    ZodomusWebhookController,
    ZodomusAdminController,
    ZodomusApiRefController,
  ],
  providers: [
    {
      provide: ZODOMUS_CLIENT,
      useFactory: (config: ConfigService): ZodomusClient | null => {
        if (!config.get<boolean>('ZODOMUS_ENABLED')) {
          return null;
        }
        return new ZodomusClient(config);
      },
      inject: [ConfigService],
    },
    ZodomusService,
    ZodomusSyncService,
    ZodomusCronService,
    ZodomusAvailabilityPushService,
    ZodomusMappingService,
  ],
  exports: [ZodomusService, ZodomusSyncService, ZodomusAvailabilityPushService, ZodomusMappingService],
})
export class ZodomusModule {}
