import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { PropertyEntity } from '../../property/entities/property.entity';
import type { GuestPriceChannel } from './property-channel-profile.entity';

/**
 * A channel's own price for one night, typed in by hand — Airbnb prices until Airbnb is connected
 * through the API. Wins over the profile's nightly / weekend price.
 */
@Entity('property_channel_night_prices')
export class PropertyChannelNightPriceEntity {
  @PrimaryColumn('uuid')
  propertyId!: string;

  @PrimaryColumn({ type: 'varchar', length: 16 })
  channel!: GuestPriceChannel;

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
