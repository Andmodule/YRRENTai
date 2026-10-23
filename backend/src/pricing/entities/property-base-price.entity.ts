import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { PropertyEntity } from '../../property/entities/property.entity';

/**
 * «Базовая цена» of one night: the property's own price for the standard number of guests (2), the one
 * the channel prices are made from (`property_channel_pricing`). RentAI is the source of truth for it.
 */
@Entity('property_base_prices')
export class PropertyBasePriceEntity {
  @PrimaryColumn('uuid')
  propertyId!: string;

  /** yyyy-MM-dd, the night. */
  @PrimaryColumn({ type: 'date' })
  date!: string;

  @ManyToOne(() => PropertyEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'propertyId' })
  property!: PropertyEntity;

  @Column({ type: 'integer' })
  priceMinor!: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
