import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { BookingWeekday } from '../../integrations/zodomus/zodomus-promotions.util';
import { PricePromotionTargetEntity } from './price-promotion-target.entity';

export type PricePromotionSource = 'rentai' | 'booking';
/** `off` = deactivated by a user; «finished» is derived from stay dates in the property timezone. */
export type PricePromotionStatus = 'active' | 'off';

/**
 * One discount campaign («Скидка») across one or many properties.
 * On Booking each property gets its own promotion (see PricePromotionTargetEntity).
 * source=booking — found in the Booking extranet during sync; read-only in RentAI.
 */
@Entity('price_promotions')
@Index('IDX_price_promotions_owner', ['ownerId', 'createdAt'])
export class PricePromotionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Tenant owner (same scoping as properties.ownerId). */
  @Column('uuid')
  ownerId!: string;

  @Column({ type: 'uuid', nullable: true })
  companyId!: string | null;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 16, default: 'rentai' })
  source!: PricePromotionSource;

  /** Booking promotion type: basic | last_minute | early_booker | … */
  @Column({ type: 'varchar', length: 32, default: 'basic' })
  promotionType!: string;

  @Column({ type: 'smallint' })
  discountPct!: number;

  /** Inclusive yyyy-MM-dd. */
  @Column({ type: 'date', nullable: true })
  stayFrom!: string | null;

  /** Inclusive yyyy-MM-dd. */
  @Column({ type: 'date', nullable: true })
  stayTo!: string | null;

  /** null = all seven days. */
  @Column({ type: 'jsonb', nullable: true })
  activeWeekdays!: BookingWeekday[] | null;

  /** Skip properties where the Genius guest price would drop below their minimum. */
  @Column({ type: 'boolean', default: true })
  protectMinPrice!: boolean;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: PricePromotionStatus;

  /** Extra Booking fields for extranet deals (last_minute unit/value, target channel, …). */
  @Column({ type: 'jsonb', nullable: true })
  externalMeta!: Record<string, unknown> | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @OneToMany(() => PricePromotionTargetEntity, (t) => t.promotion)
  targets!: PricePromotionTargetEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
