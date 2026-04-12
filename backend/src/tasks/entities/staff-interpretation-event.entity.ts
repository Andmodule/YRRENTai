import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';
import { PropertyEntity } from '../../property/entities/property.entity';
import { CompanyEntity } from '../../user/entities/company.entity';
import { SupplyRequestItemEntity } from './supply-request-item.entity';

@Entity('staff_interpretation_events')
export class StaffInterpretationEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  authorId!: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'authorId' })
  author!: UserEntity;

  @Column({ type: 'varchar', length: 32 })
  entryPoint!: string;

  @Column({ type: 'varchar', length: 16 })
  targetType!: string;

  @Column({ type: 'uuid' })
  targetId!: string;

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

  @Column({ type: 'text' })
  textRaw!: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  llmStatus!: string;

  @Column({ type: 'jsonb', nullable: true })
  llmPayload!: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  llmError!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'pending_llm' })
  workflowState!: string;

  /** When true, LLM must not auto-create an incident (e.g. voice flow already created one via checkbox). */
  @Column({ type: 'boolean', default: false })
  skipAutoIncident!: boolean;

  /**
   * Incident already created in the same voice-submit HTTP request before this row was queued.
   * Prevents a second incident if async LLM runs with a stale/wrong skipAutoIncident or races the submit handler.
   */
  @Column({ type: 'uuid', nullable: true })
  voiceLinkedIncidentId!: string | null;

  /** Set when interpretation was merged into or created a real {@link IncidentEntity}. */
  @Column({ type: 'uuid', nullable: true })
  createdIncidentId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  @OneToMany(() => SupplyRequestItemEntity, (i) => i.interpretationEvent)
  supplyItems!: SupplyRequestItemEntity[];
}
