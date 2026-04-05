import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';

/** One pending Telegram `file_id` per staff user (photo attach flow). */
@Entity('staff_telegram_pending_attachments')
export class StaffTelegramPendingAttachmentEntity {
  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: UserEntity;

  @Column({ type: 'text' })
  fileId!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;
}
