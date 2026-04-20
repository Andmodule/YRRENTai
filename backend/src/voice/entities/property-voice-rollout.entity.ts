import {
  Entity, PrimaryGeneratedColumn, Column,
  UpdateDateColumn, Index,
} from 'typeorm';

export type RolloutCohort = 'disabled' | 'pilot' | 'beta' | 'stable';
export const ROLLOUT_COHORTS: RolloutCohort[] = ['disabled', 'pilot', 'beta', 'stable'];

@Entity('property_voice_rollout')
@Index(['propertyId'], { unique: true })
@Index(['cohort', 'enabled'])
export class PropertyVoiceRolloutEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  propertyId!: string;

  @Column({ type: 'varchar', length: 16, default: 'disabled' })
  cohort!: RolloutCohort;

  /** Must be false when cohort === 'disabled' */
  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ type: 'varchar', length: 32, default: 'retell' })
  provider!: string;

  @Column({ type: 'float', nullable: true })
  confidenceThresholdOverride!: number | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  afterHoursMode!: string | null;

  @Column({ type: 'boolean', default: false })
  exportAllowed!: boolean;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}
