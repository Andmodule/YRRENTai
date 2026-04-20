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

export type SpeakerRole = 'guest' | 'ai' | 'operator';

@Entity('call_transcript_segments')
export class CallTranscriptSegmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  sessionId!: string;

  @ManyToOne(() => CallSessionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session!: CallSessionEntity;

  @Column({ type: 'int' })
  turnIndex!: number;

  @Column({ type: 'varchar', length: 16 })
  role!: SpeakerRole;

  @Column({ type: 'text' })
  content!: string;

  /** Detected language for this segment */
  @Column({ type: 'varchar', length: 16, nullable: true })
  language!: string | null;

  /** AI-extracted intent label (only for guest turns processed by orchestrator) */
  @Column({ type: 'varchar', length: 128, nullable: true })
  intent!: string | null;

  /** LLM confidence 0–1 for AI turns */
  @Column({ type: 'float', nullable: true })
  confidence!: number | null;

  /** KB article IDs that contributed to this AI response */
  @Column({ type: 'jsonb', nullable: true })
  kbSources!: string[] | null;

  /** Whether this turn triggered an escalation check */
  @Column({ type: 'boolean', default: false })
  triggeredEscalation!: boolean;

  // ── Per-turn latency breakdown (P1 observability) ─────────────────────────

  /** When this turn was received from the provider (STT final) */
  @Column({ type: 'timestamptz', nullable: true })
  turnStartedAt!: Date | null;

  /** When the first audio byte was sent back (TTS start) */
  @Column({ type: 'timestamptz', nullable: true })
  firstAudioAt!: Date | null;

  /** STT processing time (ms) — time from raw audio to transcript final */
  @Column({ type: 'int', nullable: true })
  sttLatencyMs!: number | null;

  /** KB retrieval time (ms) — embedding search + context build */
  @Column({ type: 'int', nullable: true })
  retrievalLatencyMs!: number | null;

  /** LLM inference time (ms) — first token to final JSON */
  @Column({ type: 'int', nullable: true })
  llmLatencyMs!: number | null;

  /** TTS synthesis time (ms) — LLM answer to first audio byte */
  @Column({ type: 'int', nullable: true })
  ttsLatencyMs!: number | null;

  /** Total end-to-end turn latency (ms) = turnStartedAt → firstAudioAt */
  @Column({ type: 'int', nullable: true })
  turnTotalMs!: number | null;

  /** Provider-assigned segment/utterance ID for deduplication */
  @Index({ sparse: true })
  @Column({ type: 'varchar', length: 256, nullable: true })
  providerSegmentId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  spokenAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
