import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export type AuditActionType =
  | 'export_qa_queue'
  | 'export_session_history'
  | 'review_status_changed'
  | 'review_assigned'
  | 'review_bulk_assigned'
  | 'alert_acknowledged'
  | 'alert_resolved'
  | 'rollout_changed'
  | 'provider_changed'
  | 'cohort_changed'
  | 'bulk_cohort_changed';

@Entity('voice_audit_logs')
@Index(['actorId', 'createdAt'])
@Index(['propertyId', 'createdAt'])
@Index(['actionType', 'createdAt'])
export class VoiceAuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  actorId!: string;

  @Column({ type: 'varchar', length: 32 })
  actorRole!: string;

  @Column({ type: 'varchar', length: 64 })
  actionType!: AuditActionType;

  @Column({ type: 'varchar', length: 64, nullable: true })
  entityType!: string | null;

  @Column({ type: 'uuid', nullable: true })
  entityId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  propertyId!: string | null;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
