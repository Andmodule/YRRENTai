import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { PropertyEntity } from '../../property/entities/property.entity';
import { PricePromotionEntity } from './price-promotion.entity';

/** What the user wants on Booking for this property. */
export type PromotionDesiredState = 'on' | 'off';

/**
 * Last known result on Booking:
 * pending — waiting for the queue; on/off — confirmed; error — permanent failure (see lastErrorCode);
 * skipped — not sent (below minimum price, not in pilot allowlist, no price); dry_run — would have been sent.
 */
export type PromotionTargetState = 'pending' | 'on' | 'off' | 'error' | 'skipped' | 'dry_run';

export type PromotionTargetStats = {
  bookings: number | null;
  nights: number | null;
  revenue: number | null;
  currency: string | null;
  cancellations: number | null;
  at: string;
};

/** Earlier Booking ids of this target (after a change we create a new promotion and stop the old one). */
export type PreviousPromotionId = { id: string; deactivated: boolean };

/** Column-only partial for repository.update() (relations excluded). */
export type PromotionTargetPatch = Partial<
  Omit<PricePromotionTargetEntity, 'promotion' | 'property'>
>;

/** One property inside a campaign = one Booking promotion. */
@Entity('price_promotion_targets')
@Unique('UQ_price_promotion_targets_promotion_property', ['promotionId', 'propertyId'])
@Index('IDX_price_promotion_targets_queue', ['needsPush', 'nextAttemptAt'])
@Index('IDX_price_promotion_targets_property', ['propertyId'])
export class PricePromotionTargetEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  promotionId!: string;

  @ManyToOne(() => PricePromotionEntity, (p) => p.targets, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'promotionId' })
  promotion!: PricePromotionEntity;

  @Column('uuid')
  propertyId!: string;

  @ManyToOne(() => PropertyEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'propertyId' })
  property!: PropertyEntity;

  @Column({ type: 'integer' })
  channelId!: number;

  /** Booking hotel id as known to Zodomus (channel listing external id). */
  @Column({ type: 'varchar', length: 255 })
  externalPropertyId!: string;

  @Column({ type: 'varchar', length: 8, default: 'on' })
  desiredState!: PromotionDesiredState;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  state!: PromotionTargetState;

  /** Queue flag: something must be sent to Booking for this target. */
  @Column({ type: 'boolean', default: true })
  needsPush!: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true })
  externalPromotionId!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  previousExternalIds!: PreviousPromotionId[];

  /** Fingerprint of the parameters last sent to Booking — a change triggers re-creation. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  pushedHash!: string | null;

  /** Bumped on every re-creation; part of the idempotency marker in the promotion name. */
  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ type: 'jsonb', nullable: true })
  roomIds!: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  rateIds!: string[] | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  lastErrorCode!: string | null;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  verifyNote!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  stats!: PromotionTargetStats | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
