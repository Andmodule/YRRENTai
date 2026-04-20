import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import type { CallEventEntity } from './call-event.entity';
import type { CallTranscriptSegmentEntity } from './call-transcript-segment.entity';
import type { CallHandoffEntity } from './call-handoff.entity';

export type CallDirection = 'inbound' | 'outbound';
export type CallStatus =
  | 'ringing'
  | 'in_progress'
  | 'ai_handling'
  | 'handoff_pending'
  | 'handed_off'
  | 'completed'
  | 'failed'
  | 'no_answer';

export type HandoffStatus = 'none' | 'requested' | 'in_progress' | 'completed';
export type VoiceProvider = 'retell' | 'vapi' | 'twilio';

@Entity('call_sessions')
export class CallSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Correlation ID for tracing across services */
  @Column({ type: 'varchar', length: 128, unique: true })
  correlationId!: string;

  @Column({ type: 'varchar', length: 16 })
  provider!: VoiceProvider;

  @Column({ type: 'varchar', length: 256, nullable: true })
  providerCallId!: string | null;

  @Column({ type: 'varchar', length: 8 })
  direction!: CallDirection;

  @Column({ type: 'varchar', length: 32 })
  status!: CallStatus;

  /** The DID / phone number that received the call — used to resolve propertyId */
  @Column({ type: 'varchar', length: 64, nullable: true })
  toNumber!: string | null;

  /** Caller's phone number (E.164) */
  @Column({ type: 'varchar', length: 64, nullable: true })
  guestPhone!: string | null;

  @Column({ type: 'uuid', nullable: true })
  propertyId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reservationId!: string | null;

  /** BCP-47 language code detected or defaulted */
  @Column({ type: 'varchar', length: 16, nullable: true })
  language!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ type: 'varchar', length: 32 })
  handoffStatus!: HandoffStatus;

  /** 'ai' | 'operator' | 'timeout' | 'guest_hangup' */
  @Column({ type: 'varchar', length: 32, nullable: true })
  endedBy!: string | null;

  /** Total AI turns in this session */
  @Column({ type: 'int', default: 0 })
  turnCount!: number;

  /** Average latency per AI turn in ms */
  @Column({ type: 'int', nullable: true })
  avgTurnLatencyMs!: number | null;

  /** Operator userId who took over (if any) */
  @Column({ type: 'uuid', nullable: true })
  takenOverByUserId!: string | null;

  @OneToMany('CallEventEntity', 'session')
  events!: CallEventEntity[];

  @OneToMany('CallTranscriptSegmentEntity', 'session')
  transcriptSegments!: CallTranscriptSegmentEntity[];

  @OneToMany('CallHandoffEntity', 'session')
  handoffs!: CallHandoffEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
