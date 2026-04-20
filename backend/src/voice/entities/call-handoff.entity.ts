import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { CallSessionEntity } from './call-session.entity';

export type HandoffMode = 'supervised' | 'hard_transfer';
export type HandoffHandoffStatus = 'requested' | 'accepted' | 'declined' | 'timeout' | 'completed';

@Entity('call_handoffs')
export class CallHandoffEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  sessionId!: string;

  @ManyToOne(() => CallSessionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session!: CallSessionEntity;

  @Column({ type: 'varchar', length: 32 })
  mode!: HandoffMode;

  @Column({ type: 'varchar', length: 32 })
  status!: HandoffHandoffStatus;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  /** escalation_threshold | guest_request | emergency | complaint | quiet_hours */
  @Column({ type: 'varchar', length: 64, nullable: true })
  escalationReason!: string | null;

  /** Operator who accepted the handoff */
  @Column({ type: 'uuid', nullable: true })
  acceptedByUserId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  requestedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
