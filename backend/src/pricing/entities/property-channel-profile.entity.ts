import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { PropertyEntity } from '../../property/entities/property.entity';

export type GuestPriceChannel = 'booking' | 'airbnb';

export const GUEST_PRICE_CHANNELS: readonly GuestPriceChannel[] = ['booking', 'airbnb'];

/** A discount RentAI cannot read from the channel, typed in by hand (found by a calibration). */
export type ExtraDiscount = { label: string; pct: number };

/**
 * «Цена для гостя»: what a channel adds to or takes from the price a guest pays, per property.
 * Money in minor units of the property's channel currency; null = not set.
 */
@Entity('property_channel_profiles')
export class PropertyChannelProfileEntity {
  @PrimaryColumn('uuid')
  propertyId!: string;

  @PrimaryColumn({ type: 'varchar', length: 16 })
  channel!: GuestPriceChannel;

  @ManyToOne(() => PropertyEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'propertyId' })
  property!: PropertyEntity;

  /** Per stay, never discounted. */
  @Column({ type: 'integer', nullable: true })
  cleaningFeeMinor!: number | null;

  /** VAT (%) inside the room price. */
  @Column({ type: 'smallint', nullable: true })
  vatIncludedPct!: number | null;

  /** Added on top, per guest per night. */
  @Column({ type: 'integer', nullable: true })
  cityTaxPerGuestNightMinor!: number | null;

  /** Booking: discounts the lowest guest price has that RentAI does not import. */
  @Column({ type: 'jsonb', nullable: true })
  extraDiscounts!: ExtraDiscount[] | null;

  /** Airbnb length-of-stay discounts (7+ / 28+ nights). */
  @Column({ type: 'smallint', nullable: true })
  weeklyPct!: number | null;

  @Column({ type: 'smallint', nullable: true })
  monthlyPct!: number | null;

  /** Airbnb nightly price until the channel is connected through the API; Fri and Sat nights use the weekend one. */
  @Column({ type: 'integer', nullable: true })
  nightlyMinor!: number | null;

  @Column({ type: 'integer', nullable: true })
  weekendNightlyMinor!: number | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
