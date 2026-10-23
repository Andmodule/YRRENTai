import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { PropertyEntity } from '../../property/entities/property.entity';
import type { GuestPriceChannel } from './property-channel-profile.entity';

/**
 * How a channel's price is made from the base price, per property. A table of its own (not columns of
 * `property_channel_profiles`): «Цена для гостя» reads the profiles and must keep working whatever the
 * order of deploy and migration.
 */
@Entity('property_channel_pricing')
export class PropertyChannelPricingEntity {
  @PrimaryColumn('uuid')
  propertyId!: string;

  @PrimaryColumn({ type: 'varchar', length: 16 })
  channel!: GuestPriceChannel;

  @ManyToOne(() => PropertyEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'propertyId' })
  property!: PropertyEntity;

  /** Channel price = base × (100 + markupPct) / 100, rounded to whole units. May be negative. */
  @Column({ type: 'smallint', default: 0 })
  markupPct!: number;

  /** One guest pays this % less than the standard two (shown in «Цена для гостя»; not sent to Booking). */
  @Column({ type: 'smallint', nullable: true })
  singleGuestPct!: number | null;

  /** Each guest above two adds this % (shown in «Цена для гостя»; not sent to Booking). */
  @Column({ type: 'smallint', nullable: true })
  extraGuestPct!: number | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
