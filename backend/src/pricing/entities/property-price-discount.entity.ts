import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PropertyEntity } from '../../property/entities/property.entity';

/**
 * «Скидка» on the nights [dateFrom, dateTo] (inclusive): the channel price of every night goes down by `pct`
 * on the chosen channels. Kept as its own row, on top of the base price — the base price is never rewritten,
 * so deleting the row brings the price back to the current base. Overlapping discounts: the biggest wins.
 * Not a Booking promotion (no Basic deal is created): the guest sees a lower price, not a crossed-out one.
 */
@Entity('property_price_discounts')
@Index('IDX_property_price_discounts_property_dates', ['propertyId', 'dateFrom', 'dateTo'])
@Check('CHK_property_price_discounts_pct', '"pct" BETWEEN 1 AND 90')
@Check('CHK_property_price_discounts_dates', '"dateFrom" <= "dateTo"')
export class PropertyPriceDiscountEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  propertyId!: string;

  @ManyToOne(() => PropertyEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'propertyId', foreignKeyConstraintName: 'FK_property_price_discounts_property' })
  property!: PropertyEntity;

  /** yyyy-MM-dd, first night. */
  @Column({ type: 'date' })
  dateFrom!: string;

  /** yyyy-MM-dd, last night (inclusive). */
  @Column({ type: 'date' })
  dateTo!: string;

  /** 1…90. */
  @Column({ type: 'smallint' })
  pct!: number;

  /** 'booking' / 'airbnb'. */
  @Column({ type: 'jsonb' })
  channels!: string[];

  @Column({ type: 'varchar', length: 80, nullable: true })
  name!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
