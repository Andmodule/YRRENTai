import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { PropertyEntity } from '../../property/entities/property.entity';

/**
 * Discounts set up in Airbnb itself, typed in by hand (RentAI cannot read them): «Бронирование в последнюю минуту»
 * and «Раннее бронирование». Only to show what the guest pays — RentAI sends Airbnb the same price either way,
 * Airbnb takes these off by itself. A null percent = not set.
 */
@Entity('property_airbnb_deals')
@Check('CHK_property_airbnb_deals_last_minute', '"lastMinutePct" IS NULL OR ("lastMinutePct" BETWEEN 1 AND 99 AND "lastMinuteDays" BETWEEN 0 AND 28)')
@Check('CHK_property_airbnb_deals_early_bird', '"earlyBirdPct" IS NULL OR ("earlyBirdPct" BETWEEN 1 AND 99 AND "earlyBirdMonths" BETWEEN 1 AND 36)')
export class PropertyAirbnbDealsEntity {
  @PrimaryColumn('uuid')
  propertyId!: string;

  @ManyToOne(() => PropertyEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'propertyId', foreignKeyConstraintName: 'FK_property_airbnb_deals_property' })
  property!: PropertyEntity;

  /** −N % for bookings made 0…lastMinuteDays days before arrival. */
  @Column({ type: 'smallint', nullable: true })
  lastMinutePct!: number | null;

  @Column({ type: 'smallint', nullable: true })
  lastMinuteDays!: number | null;

  /** −N % for bookings made earlyBirdMonths months or more before arrival. */
  @Column({ type: 'smallint', nullable: true })
  earlyBirdPct!: number | null;

  @Column({ type: 'smallint', nullable: true })
  earlyBirdMonths!: number | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
