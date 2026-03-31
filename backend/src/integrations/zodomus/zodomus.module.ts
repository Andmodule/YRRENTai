import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ZODOMUS_CLIENT } from './zodomus.tokens';
import { ZodomusClient } from './zodomus.client';
import { ZodomusService } from './zodomus.service';
import { ZodomusSyncService } from './zodomus-sync.service';
import { ZodomusController } from './zodomus.controller';
import { BookingEntity } from '../../booking/entities/booking.entity';
import { PropertyModule } from '../../property/property.module';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([BookingEntity]), PropertyModule],
  controllers: [ZodomusController],
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
  ],
  exports: [ZodomusService, ZodomusSyncService],
})
export class ZodomusModule {}
