import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, Index, ManyToOne, JoinColumn,
} from 'typeorm';
import { VoiceAlertRuleEntity } from './voice-alert-rule.entity';
import type { AlertMetricKey } from '../constants/voice-alert-thresholds';

export type AlertSeverity = 'warning' | 'critical';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved';

@Entity('voice_alerts')
@Index(['ruleId', 'status'])
@Index(['propertyId', 'status'])
export class VoiceAlertEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  ruleId!: string;

  @ManyToOne(() => VoiceAlertRuleEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ruleId' })
  rule!: VoiceAlertRuleEntity;

  @Column({ type: 'varchar', length: 16 })
  severity!: AlertSeverity;

  @Column({ type: 'varchar', length: 64 })
  metricKey!: AlertMetricKey;

  @Column({ type: 'float' })
  currentValue!: number;

  @Column({ type: 'float' })
  thresholdValue!: number;

  @Column({ type: 'uuid', nullable: true })
  propertyId!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  provider!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: AlertStatus;

  /**
   * Consecutive evaluation cycles where the metric was healthy (below threshold).
   * Alert auto-resolves only when recoveryStreak >= ALERT_AUTO_RESOLVE_STREAK.
   * Prevents flapping on borderline metrics.
   */
  @Column({ type: 'int', default: 0 })
  recoveryStreak!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  firstTriggeredAt!: Date;

  @Column({ type: 'timestamptz' })
  lastTriggeredAt!: Date;

  @Column({ type: 'uuid', nullable: true })
  acknowledgedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  acknowledgedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;
}
