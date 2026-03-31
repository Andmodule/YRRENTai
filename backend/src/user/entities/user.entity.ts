import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  email!: string;

  @Column()
  passwordHash!: string;

  @Column()
  firstName!: string;

  @Column()
  lastName!: string;

  @Column({ nullable: true })
  phone?: string;

  /** Telegram chat_id for escalation alerts — shared across all properties of this account */
  @Column({ nullable: true })
  telegramChatId?: string;

  @Column({ default: 'OWNER' })
  role!: string;

  @Column({ default: 'ru' })
  language!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  /** STAFF: last time shift was explicitly completed (for manager visibility). */
  @Column({ type: 'timestamptz', nullable: true })
  staffShiftCompletedAt!: Date | null;
}
