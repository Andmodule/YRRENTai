import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('companies')
export class CompanyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /** Shared description for all properties (AI + managers). Property KB overrides on conflict. */
  @Column({ type: 'text', nullable: true })
  globalDescription!: string | null;

  /** Shared house rules for all properties. Property KB overrides on conflict. */
  @Column({ type: 'text', nullable: true })
  globalRules!: string | null;

  /**
   * Company-wide FAQ: [{ id, question, answer }]. Property KB overrides on the same topic.
   */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  globalQaEntries!: { id: string; question: string; answer: string }[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
