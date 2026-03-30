import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ConversationEntity } from './conversation.entity';

export type MessageSource = 'ai' | 'staff';

@Entity('chat_messages')
@Index('IDX_msg_conversation', ['conversationId'])
export class ChatMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  propertyId!: string;

  @Column('uuid', { nullable: true })
  conversationId?: string;

  @ManyToOne(() => ConversationEntity, (c) => c.messages, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'conversationId' })
  conversation?: ConversationEntity;

  @Column('uuid', { nullable: true })
  userId?: string;

  @Column({ type: 'text' })
  content!: string;

  @Column()
  role!: string;

  @Column({ default: 'ai' })
  source!: MessageSource;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
