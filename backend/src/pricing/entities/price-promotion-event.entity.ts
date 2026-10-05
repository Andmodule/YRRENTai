import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PricePromotionEntity } from './price-promotion.entity';

/** History line of a discount («История»): who did what, or what Booking answered. */
@Entity('price_promotion_events')
@Index('IDX_price_promotion_events_promotion', ['promotionId', 'createdAt'])
export class PricePromotionEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  promotionId!: string;

  @ManyToOne(() => PricePromotionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'promotionId' })
  promotion!: PricePromotionEntity;

  /** Set for per-property events. */
  @Column({ type: 'uuid', nullable: true })
  propertyId!: string | null;

  /** null = RentAI itself (queue / sync). */
  @Column({ type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ type: 'varchar', length: 255 })
  actorLabel!: string;

  @Column({ type: 'varchar', length: 48 })
  action!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'jsonb', nullable: true })
  details!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
