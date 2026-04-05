import { Module } from '@nestjs/common';
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
import { BookingEntity } from '../../booking/entities/booking.entity';
import { PropertyEntity } from '../../property/entities/property.entity';
import { PropertyModule } from '../../property/property.module';
import { UserModule } from '../../user/user.module';
import { ZodomusAvailabilityPushService } from './zodomus-availability-push.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([BookingEntity, PropertyEntity]),
    PropertyModule,
    UserModule,
  ],
  controllers: [ZodomusController, ZodomusWebhookController, ZodomusAdminController],
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
  ],
  exports: [ZodomusService, ZodomusSyncService, ZodomusAvailabilityPushService],
})
export class ZodomusModule {}
