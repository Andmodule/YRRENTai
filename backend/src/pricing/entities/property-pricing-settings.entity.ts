import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { PropertyEntity } from '../../property/entities/property.entity';

export type PromotionsAccess = 'ok' | 'denied' | 'unknown';

/**
 * Per-property pricing settings («Цены → Минимальные цены»).
 * Kept outside `properties` on purpose: existing property queries stay untouched by this feature.
 */
@Entity('property_pricing_settings')
export class PropertyPricingSettingsEntity {
  @PrimaryColumn('uuid')
  propertyId!: string;

  @OneToOne(() => PropertyEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'propertyId' })
  property!: PropertyEntity;

  /** Minimum nightly price in minor units of the Booking price currency; null = not set. */
  @Column({ type: 'integer', nullable: true })
  minPriceMinor!: number | null;

  /** Genius discount of the property on Booking (Booking API does not expose it). */
  @Column({ type: 'smallint', nullable: true })
  geniusPct!: number | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  promotionsAccess!: PromotionsAccess | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  promotionsAccessCode!: string | null;

  @Column({ type: 'text', nullable: true })
  promotionsAccessDetail!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  promotionsAccessCheckedAt!: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
