import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { PropertyEntity } from '../../property/entities/property.entity';
import { TaskEntity } from '../../tasks/entities/task.entity';
import { UserEntity } from '../../user/entities/user.entity';
import { CompanyEntity } from '../../user/entities/company.entity';

export type IncidentType = 'lost_item' | 'damage' | 'rule_violation' | 'emergency';
export type IncidentStatus = 'open' | 'in_review' | 'resolved' | 'closed';

@Entity('incidents')
export class IncidentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  type!: IncidentType;

  @Column({ type: 'varchar', length: 32, default: 'open' })
  status!: IncidentStatus;

  @Column({ type: 'uuid' })
  propertyId!: string;

  @ManyToOne(() => PropertyEntity)
  @JoinColumn({ name: 'propertyId' })
  property!: PropertyEntity;

  @Column({ type: 'uuid' })
  companyId!: string;

  @ManyToOne(() => CompanyEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'companyId' })
  company!: CompanyEntity;

  @Column({ type: 'uuid', nullable: true })
  taskId!: string | null;

  @ManyToOne(() => TaskEntity, { nullable: true })
  @JoinColumn({ name: 'taskId' })
  task!: TaskEntity | null;

  /** Maintenance task created after manager verified and dispatched (not auto-notified before this). */
  @Column({ type: 'uuid', nullable: true })
  dispatchedTaskId!: string | null;

  @ManyToOne(() => TaskEntity, { nullable: true })
  @JoinColumn({ name: 'dispatchedTaskId' })
  dispatchedTask!: TaskEntity | null;

  @Column({ type: 'uuid', nullable: true })
  reservationId!: string | null;

  @Column({ type: 'uuid' })
  reportedBy!: string;

  @ManyToOne(() => UserEntity, { eager: false })
  @JoinColumn({ name: 'reportedBy' })
  reporter!: UserEntity;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  photoUrls!: string[];

  @Column({ type: 'varchar', length: 255, nullable: true })
  guestName!: string | null;

  @Column({ type: 'text', nullable: true })
  itemDescription!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  damageLocation!: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  estimatedCost!: string | null;

  @Column({ type: 'text', nullable: true })
  managerNote!: string | null;

  /** Telegram message_id of our incident alert (reply threads manager → staff note). */
  @Column({ type: 'bigint', nullable: true })
  telegramNotifyMessageId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  resolvedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
