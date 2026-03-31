import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PropertyModule } from '../property/property.module';
import { TaskEntity } from '../tasks/entities/task.entity';
import { IncidentEntity } from '../incidents/entities/incident.entity';
import { BookingEntity } from '../booking/entities/booking.entity';
import { InventoryItemEntity } from './entities/inventory-item.entity';
import { InventoryMovementEntity } from './entities/inventory-movement.entity';
import { PropertyListingTranslationEntity } from './entities/property-listing-translation.entity';
import { InventoryService } from './inventory.service';
import { ListingTranslationsService } from './listing-translations.service';
import { ManagerReportsService } from './manager-reports.service';
import { OperationsController } from './operations.controller';

@Module({
  imports: [
    PropertyModule,
    TypeOrmModule.forFeature([
      InventoryItemEntity,
      InventoryMovementEntity,
      PropertyListingTranslationEntity,
      TaskEntity,
      IncidentEntity,
      BookingEntity,
    ]),
  ],
  controllers: [OperationsController],
  providers: [InventoryService, ListingTranslationsService, ManagerReportsService],
  exports: [InventoryService, ListingTranslationsService, ManagerReportsService],
})
export class OperationsModule {}
