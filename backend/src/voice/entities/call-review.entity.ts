import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { CallSessionEntity } from './call-session.entity';

export type QaFlag =
  | 'low_confidence'
  | 'fallback_triggered'
  | 'unresolved_question'
  | 'emergency_detected'
  | 'complaint_detected'
  | 'transfer_failed'
  | 'long_session'
  | 'kb_miss'
  | 'repeat_guest'
  | 'high_latency';

/** Legacy statuses kept for backward compat; new workflow uses open/in_review/resolved */
export type ReviewStatus =
  | 'open'
  | 'in_review'
  | 'resolved'
  | 'escalated'
  | 'pending'   // legacy alias for open
  | 'reviewed'  // legacy alias for resolved
  | 'closed';

export const QA_WORKFLOW_STATUSES: ReviewStatus[] = ['open', 'in_review', 'resolved', 'escalated'];

@Entity('call_reviews')
export class CallReviewEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column('uuid')
  sessionId!: string;

  @ManyToOne(() => CallSessionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session!: CallSessionEntity;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status!: ReviewStatus;

  // ── AI-generated call summary ──────────────────────────────────────────────
  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  /** Chronological list of detected intents (e.g. ["wifi", "checkin", "parking"]) */
  @Column({ type: 'jsonb', nullable: true })
  detectedIntents!: string[] | null;

  /** Questions the AI could not confidently answer */
  @Column({ type: 'jsonb', nullable: true })
  unresolvedQuestions!: string[] | null;

  /** Why the call escalated (null = no escalation) */
  @Column({ type: 'text', nullable: true })
  escalationReason!: string | null;

  /** Transfer outcome: completed | failed | recovered | none */
  @Column({ type: 'varchar', length: 32, nullable: true })
  transferOutcome!: string | null;

  /** Structured QA flags */
  @Column({ type: 'jsonb', nullable: true })
  qaFlags!: QaFlag[] | null;

  /** Whether a human follow-up is suggested */
  @Column({ type: 'boolean', default: false })
  followUpRequired!: boolean;

  /** Suggested follow-up action for the operator */
  @Column({ type: 'text', nullable: true })
  followUpSuggestion!: string | null;

  /** KB articles that should be improved based on this call */
  @Column({ type: 'jsonb', nullable: true })
  kbImprovementHints!: Array<{ question: string; suggestedUpdate: string }> | null;

  // ── Operator review ────────────────────────────────────────────────────────
  @Column({ type: 'uuid', nullable: true })
  reviewedByUserId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  reviewerNote!: string | null;

  /** Operator quality rating 1–5 */
  @Column({ type: 'int', nullable: true })
  qualityRating!: number | null;

  // ── QA ownership ───────────────────────────────────────────────────────────
  @Column({ type: 'uuid', nullable: true })
  assigneeId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  assignedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  assignedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  dueAt!: Date | null;

  @Column({ type: 'varchar', length: 16, default: 'normal' })
  priority!: 'low' | 'normal' | 'high' | 'urgent';

  @Column({ type: 'text', nullable: true })
  resolutionNote!: string | null;

  // ── Aggregate metrics snapshot ─────────────────────────────────────────────
  @Column({ type: 'int', nullable: true })
  totalTurns!: number | null;

  @Column({ type: 'int', nullable: true })
  avgTurnLatencyMs!: number | null;

  @Column({ type: 'float', nullable: true })
  avgConfidence!: number | null;

  @Column({ type: 'int', nullable: true })
  fallbackCount!: number | null;

  @Column({ type: 'int', nullable: true })
  durationSeconds!: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
