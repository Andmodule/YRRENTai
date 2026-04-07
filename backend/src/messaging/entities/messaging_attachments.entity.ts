import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { MessagingMessageEntity } from './messaging-message.entity';

@Entity('messaging_attachments')
@Index('idx_messaging_attachments_message', ['messageId'])
export class MessagingAttachmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'message_id', type: 'uuid' })
  messageId!: string;

  @ManyToOne(() => MessagingMessageEntity, (m) => m.attachments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message!: MessagingMessageEntity;

  @Column({ name: 'file_name', type: 'varchar', length: 1024 })
  fileName!: string;

  @Column({ name: 'content_type', type: 'varchar', length: 255 })
  contentType!: string;

  @Column({ name: 'size_bytes', type: 'integer' })
  sizeBytes!: number;

  @Column({ name: 'storage_key', type: 'varchar', length: 2048 })
  storageKey!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
