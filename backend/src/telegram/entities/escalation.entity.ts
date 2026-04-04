import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/** Whether this resolved escalation is still queued for KB improvement */
export type KbProcessingStatus = 'pending' | 'added_to_kb' | 'ignored';

@Entity('escalations')
export class EscalationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  propertyId!: string;

  @Column('uuid', { nullable: true })
  conversationId?: string;

  @Column()
  propertyName!: string;

  @Column('uuid', { nullable: true })
  guestMessageId?: string;

  /** Email bridge: `messaging_threads.id` — надёжный якорь, если `conversationId` ещё не проставлен. */
  @Column('uuid', { nullable: true })
  messagingThreadId?: string | null;

  @Column({ type: 'text' })
  guestQuestion!: string;

  /** Telegram message_id of the bot alert — used to match manager replies */
  @Column({ type: 'bigint', nullable: true })
  tgBotMessageId?: number;

  @Column({ type: 'text', nullable: true })
  staffReply?: string;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt?: Date;

  /** NULL = legacy pending (treat as pending in KB queue) */
  @Column({ type: 'varchar', length: 32, nullable: true })
  kbProcessingStatus?: KbProcessingStatus | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
