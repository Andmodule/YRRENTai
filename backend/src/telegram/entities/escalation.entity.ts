import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('escalations')
export class EscalationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  propertyId!: string;

  @Column()
  propertyName!: string;

  @Column('uuid', { nullable: true })
  guestMessageId?: string;

  @Column({ type: 'text' })
  guestQuestion!: string;

  /** Telegram message_id of the bot alert — used to match manager replies */
  @Column({ type: 'bigint', nullable: true })
  tgBotMessageId?: number;

  @Column({ type: 'text', nullable: true })
  staffReply?: string;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt?: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
