import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { CallSessionEntity } from './call-session.entity';

export type CallEventType =
  | 'session_created'
  | 'session_started'
  | 'session_ended'
  | 'transcript_segment'
  | 'ai_turn_start'
  | 'ai_turn_end'
  | 'intent_detected'
  | 'policy_decision'
  | 'escalation_requested'
  | 'handoff_started'
  | 'handoff_completed'
  | 'operator_takeover'
  | 'property_resolved'
  | 'fallback_triggered'
  | 'error'
  | 'provider_webhook'
  | 'emergency_guard';

@Entity('call_events')
export class CallEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  sessionId!: string;

  @ManyToOne(() => CallSessionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session!: CallSessionEntity;

  @Column({ type: 'varchar', length: 64 })
  type!: CallEventType;

  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;

  /** For AI turns: latency in ms from STT-done to TTS-start */
  @Column({ type: 'int', nullable: true })
  latencyMs!: number | null;

  /**
   * Globally unique key for idempotent event processing.
   * Derived from: providerCallId + eventType + turnIndex (or provider event id).
   * Duplicate events with the same key are safely ignored.
   */
  @Index({ unique: true, sparse: true })
  @Column({ type: 'varchar', length: 256, nullable: true })
  idempotencyKey!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
