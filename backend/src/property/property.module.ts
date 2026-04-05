import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModule } from '../user/user.module';
import { PropertyController } from './property.controller';
import { OtaPlatformController } from './ota-platform.controller';
import { PropertyService } from './property.service';
import { OtaPlatformService } from './ota-platform.service';
import { PropertyEntity } from './entities/property.entity';
import { PropertyChannelListingEntity } from './entities/property-channel-listing.entity';
import { OtaPlatformEntity } from './entities/ota-platform.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([PropertyEntity, PropertyChannelListingEntity, OtaPlatformEntity]),
    forwardRef(() => UserModule),
  ],
  controllers: [PropertyController, OtaPlatformController],
  providers: [PropertyService, OtaPlatformService],
  exports: [PropertyService, OtaPlatformService],
})
export class PropertyModule {}
