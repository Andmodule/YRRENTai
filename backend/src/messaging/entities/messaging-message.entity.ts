import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { MessagingThreadEntity } from './messaging-thread.entity';
import { MessagingAttachmentEntity } from './messaging_attachments.entity';

export type MessagingMessageRole = 'guest' | 'ai_draft' | 'sent';

@Entity('messaging_messages')
@Index('idx_messaging_messages_thread', ['threadId'])
export class MessagingMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'thread_id', type: 'uuid' })
  threadId!: string;

  @ManyToOne(() => MessagingThreadEntity, (t) => t.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'thread_id' })
  thread!: MessagingThreadEntity;

  @Column({ type: 'varchar', length: 32 })
  role!: MessagingMessageRole;

  @Column({ type: 'text' })
  text!: string;

  /**
   * Normalized text for LLM / KB: guest inquiry (e.g. Booking strip) + attachment placeholders.
   * UI / `text` keeps full body for display. Null on legacy rows — fallback to `text` in agent history.
   */
  @Column({ name: 'agent_text', type: 'text', nullable: true })
  agentText!: string | null;

  @Column({ name: 'raw_email_id', type: 'varchar', nullable: true, unique: true })
  rawEmailId!: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => MessagingAttachmentEntity, (a) => a.message)
  attachments!: MessagingAttachmentEntity[];
}
