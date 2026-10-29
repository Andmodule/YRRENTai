import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * The Airbnb listing connected to a RentAI property (only the pilot one, see airbnb-pilot.util.ts) and what
 * its calendar was last sent. Migration 1778900000000-zodomus-airbnb-hosts; read only while
 * ZODOMUS_AIRBNB_ENABLED=true.
 */
@Entity('zodomus_airbnb_listings')
export class ZodomusAirbnbListingEntity {
  @PrimaryColumn('uuid')
  propertyId!: string;

  /** Airbnb listing id as a string (64-bit today, up to 128 chars later). */
  @Column({ type: 'varchar', length: 128, unique: true })
  listingId!: string;

  /** POST /property-activation went through. */
  @Column({ type: 'timestamptz', nullable: true })
  activatedAt!: Date | null;

  /** Nights the last full send left unavailable for want of a price: a freed night there stays closed. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  noPriceNights!: string[];

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncAt!: Date | null;

  /** Result of the last send: operations sent, failed chunks, kind (full / availability). */
  @Column({ type: 'jsonb', nullable: true })
  lastSync!: Record<string, unknown> | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
