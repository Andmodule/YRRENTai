import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type KbStatus = 'active' | 'pending' | 'archived';

@Entity('knowledge_base_entries')
export class KnowledgeBaseEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  propertyId!: string;

  @Column()
  title!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ nullable: true })
  category?: string;

  @Column({ default: 'active' })
  status!: KbStatus;

  /**
   * JSON-serialised float array (text cast to vector in raw SQL for pgvector).
   * Generated asynchronously after create/update via EmbeddingService.
   */
  @Column({ type: 'text', nullable: true })
  embedding?: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
