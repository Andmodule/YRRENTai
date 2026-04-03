import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PropertyController } from './property.controller';
import { OtaPlatformController } from './ota-platform.controller';
import { PropertyService } from './property.service';
import { OtaPlatformService } from './ota-platform.service';
import { PropertyEntity } from './entities/property.entity';
import { OtaPlatformEntity } from './entities/ota-platform.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PropertyEntity, OtaPlatformEntity])],
  controllers: [PropertyController, OtaPlatformController],
  providers: [PropertyService, OtaPlatformService],
  exports: [PropertyService, OtaPlatformService],
})
export class PropertyModule {}
