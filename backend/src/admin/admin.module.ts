import { Module } from '@nestjs/common';
import { PropertyModule } from '../property/property.module';
import { AdminPropertiesController } from './admin-properties.controller';

@Module({
  imports: [PropertyModule],
  controllers: [AdminPropertiesController],
})
export class AdminModule {}
