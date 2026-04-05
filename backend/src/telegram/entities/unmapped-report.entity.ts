import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';

/** Voice transcript and/or photo saved when staff had no active task context (manager triage). */
@Entity('staff_unmapped_reports')
export class UnmappedReportEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: UserEntity;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  photoUrl!: string | null;

  @Column({ type: 'text', nullable: true })
  transcript!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
