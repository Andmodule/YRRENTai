import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type AfterHoursMode = 'voicemail' | 'transfer' | 'short_ai' | 'reject';

/**
 * Per-property voice AI policy.
 * Replaces env-level feature flags with persistent, editable configuration.
 * One row per property — upserted on first call if missing (defaults to safe values).
 */
@Entity('property_voice_policies')
export class PropertyVoicePolicyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column('uuid')
  propertyId!: string;

  // ── Feature flags ─────────────────────────────────────────────────────────
  @Column({ type: 'boolean', default: false })
  voiceAssistantEnabled!: boolean;

  @Column({ type: 'boolean', default: false })
  autoAnswerEnabled!: boolean;

  @Column({ type: 'boolean', default: false })
  recordCallsEnabled!: boolean;

  // ── Confidence / quality thresholds ───────────────────────────────────────
  /** Confidence below which AI should clarify rather than answer */
  @Column({ type: 'float', default: 0.55 })
  clarifyThreshold!: number;

  /** Confidence below which AI should escalate to operator */
  @Column({ type: 'float', default: 0.35 })
  escalateThreshold!: number;

  /** Max number of AI turns before forced handoff */
  @Column({ type: 'int', default: 12 })
  maxTurns!: number;

  // ── Routing ───────────────────────────────────────────────────────────────
  /** E.164 number for hard transfer (overrides env HANDOFF_TRANSFER_NUMBER) */
  @Column({ type: 'varchar', length: 32, nullable: true })
  fallbackTransferNumber!: string | null;

  /** What to do when a call arrives outside business hours */
  @Column({ type: 'varchar', length: 32, default: 'short_ai' })
  afterHoursMode!: AfterHoursMode;

  /** Quiet hours start (24h, property timezone) */
  @Column({ type: 'int', default: 22 })
  quietHoursStart!: number;

  /** Quiet hours end (24h, property timezone) */
  @Column({ type: 'int', default: 8 })
  quietHoursEnd!: number;

  // ── Behaviour ────────────────────────────────────────────────────────────
  @Column({ type: 'boolean', default: true })
  emergencyEscalationEnabled!: boolean;

  /** Whether complaint-type calls should auto-escalate */
  @Column({ type: 'boolean', default: true })
  complaintAutoEscalate!: boolean;

  /** Preferred language(s) for AI responses — BCP-47, comma-separated */
  @Column({ type: 'varchar', length: 64, default: 'ru' })
  preferredLanguages!: string;

  /** Short-answer mode: force responses ≤ 2 sentences */
  @Column({ type: 'boolean', default: true })
  shortAnswerMode!: boolean;

  // ── Allowed / blocked topics ──────────────────────────────────────────────
  /** Comma-separated topic labels AI is allowed to discuss */
  @Column({ type: 'text', nullable: true })
  allowedTopics!: string | null;

  /** Topics that always trigger escalation */
  @Column({ type: 'text', nullable: true })
  escalationTopics!: string | null;

  /** Custom fallback phrases (JSON array) by language key */
  @Column({ type: 'jsonb', nullable: true })
  customFallbackPhrases!: Record<string, string[]> | null;

  // ── Privacy & data retention ──────────────────────────────────────────────
  /** How many days to keep transcript segments (0 = forever) */
  @Column({ type: 'int', default: 90 })
  transcriptRetentionDays!: number;

  /** Replace phone numbers, emails and names in stored transcripts */
  @Column({ type: 'boolean', default: false })
  redactionEnabled!: boolean;

  /** Allow transcript export via API */
  @Column({ type: 'boolean', default: true })
  exportAllowed!: boolean;

  /** Keep audio recordings (provider side) */
  @Column({ type: 'boolean', default: false })
  recordingStorageEnabled!: boolean;

  /** Max days to keep call recordings at provider */
  @Column({ type: 'int', default: 30 })
  recordingRetentionDays!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
