import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';

@Entity('staff_daily_digest_sent')
@Unique(['userId', 'digestDate', 'timezone'])
export class StaffDailyDigestSentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: UserEntity;

  @Column({ type: 'date' })
  digestDate!: Date;

  @Column({ type: 'varchar', length: 128 })
  timezone!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
