import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { CompanyEntity } from './company.entity';

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

  /**
   * Telegram chat_id (string — avoids JS precision loss). Unique when set.
   * Used for owner escalation alerts and staff bot / Mini App binding.
   */
  @Column({ type: 'varchar', length: 64, nullable: true, unique: true })
  telegramChatId?: string | null;

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

  /**
   * STAFF: frontline role (cleaning, maintenance, etc.). Null for OWNER/MANAGER or legacy rows.
   */
  @Column({ type: 'varchar', length: 32, nullable: true })
  staffJobType?: string | null;

  /**
   * Optional Telegram @username (no @), for contact display before bot links `telegramChatId`.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  telegramUsername?: string | null;

  /**
   * For STAFF / MANAGER users: links them to the OWNER account they work under.
   * Used to scope assignee lookups to the correct tenant.
   */
  @Column({ type: 'uuid', nullable: true })
  employerOwnerId!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'employerOwnerId' })
  employerOwner!: UserEntity | null;

  /** Tenant scope; null only for SUPERADMIN (platform). */
  @Column({ type: 'uuid', nullable: true })
  companyId!: string | null;

  @ManyToOne(() => CompanyEntity, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'companyId' })
  company!: CompanyEntity | null;
}
