import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';
import {
  AlertMetricKey,
  DEFAULT_ALERT_THRESHOLDS,
  ALERT_METRIC_KEYS,
} from '../constants/voice-alert-thresholds';

// Re-export so existing imports from this file keep working
export type { AlertMetricKey };
export { DEFAULT_ALERT_THRESHOLDS as DEFAULT_THRESHOLDS, ALERT_METRIC_KEYS };

export type AlertComparator = 'gt' | 'gte';

@Entity('voice_alert_rules')
@Index(['ownerId', 'metricKey', 'propertyId'], { unique: false })
export class VoiceAlertRuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  ownerId!: string;

  @Column({ type: 'uuid', nullable: true })
  propertyId!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  provider!: string | null;

  @Column({ type: 'varchar', length: 64 })
  metricKey!: AlertMetricKey;

  @Column({ type: 'float', nullable: true })
  warningThreshold!: number | null;

  @Column({ type: 'float', nullable: true })
  criticalThreshold!: number | null;

  @Column({ type: 'varchar', length: 8, default: 'gt' })
  comparator!: AlertComparator;

  /** Rolling window in minutes for rate-based metrics */
  @Column({ type: 'int', default: 60 })
  windowMinutes!: number;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
