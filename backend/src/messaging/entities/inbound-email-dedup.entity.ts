import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm';

@Entity('inbound_email_dedup')
@Unique('UQ_inbound_email_dedup_provider_external', ['provider', 'externalId'])
@Index('idx_inbound_email_dedup_created', ['createdAt'])
export class InboundEmailDedupEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  provider!: string;

  @Column({ name: 'external_id', type: 'varchar', length: 255 })
  externalId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
