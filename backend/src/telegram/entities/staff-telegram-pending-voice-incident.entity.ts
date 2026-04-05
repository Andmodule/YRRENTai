import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';

/** Pending incident when LLM could not pick a property (inline keyboard follow-up). */
@Entity('staff_telegram_pending_voice_incidents')
export class StaffTelegramPendingVoiceIncidentEntity {
  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: UserEntity;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text' })
  transcript!: string;

  @Column({ type: 'jsonb' })
  candidatePropertyIds!: string[];

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;
}
