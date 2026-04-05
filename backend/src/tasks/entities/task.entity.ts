import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { PropertyEntity } from '../../property/entities/property.entity';
import { UserEntity } from '../../user/entities/user.entity';
import { CompanyEntity } from '../../user/entities/company.entity';

@Entity('tasks')
export class TaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  title!: string;

  @Column({ type: 'varchar', length: 32 })
  type!: string;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status!: string;

  @Column({ type: 'varchar', length: 32, default: 'normal' })
  priority!: string;

  @Column({ type: 'uuid' })
  propertyId!: string;

  /** True when the task applies to all listings (UI: "general"); DB still stores a fallback propertyId. */
  @Column({ type: 'boolean', default: false })
  isGeneralTask!: boolean;

  @ManyToOne(() => PropertyEntity)
  @JoinColumn({ name: 'propertyId' })
  property!: PropertyEntity;

  @Column({ type: 'uuid' })
  companyId!: string;

  @ManyToOne(() => CompanyEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'companyId' })
  company!: CompanyEntity;

  @Column({ type: 'uuid', nullable: true })
  reservationId!: string | null;

  @Column({ type: 'text', nullable: true })
  contextLabel!: string | null;

  @Column({ type: 'uuid', nullable: true })
  assigneeId!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'assigneeId' })
  assignee!: UserEntity | null;

  @Column({ type: 'uuid', nullable: true })
  createdById!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy!: UserEntity | null;

  @Column({ type: 'varchar', length: 10 })
  dueDate!: string;

  @Column({ type: 'varchar', length: 8, nullable: true })
  dueTime!: string | null;

  @Column({ type: 'text', default: '' })
  notes!: string;

  @Column({ type: 'text', nullable: true })
  issueDescription!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  photoUrls!: string[];

  @Column({ type: 'boolean', default: false })
  hasVerificationPhoto!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastManagerSeenAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  inProgressStartedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  /** Parent incident when this task was created from Smart Dispatch (maintenance follow-up). */
  @Column({ type: 'uuid', nullable: true })
  incidentId!: string | null;
}
