import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import type { ChatMessageMetadata } from '@rentai/shared';
import { ConversationEntity } from './conversation.entity';
import { MessageChannel } from '../enums/message-channel.enum';
import { MessageDeliveryStatus } from '../enums/message-delivery-status.enum';

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

  /** Structured payload for OTA templates (e.g. Booking.com email parse). */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: ChatMessageMetadata | null;

  @Column()
  role!: string;

  @Column({ default: 'ai' })
  source!: MessageSource;

  @Column({
    type: 'enum',
    enum: MessageChannel,
    enumName: 'chat_messages_channel_enum',
    default: MessageChannel.BOOKING_API,
  })
  channel!: MessageChannel;

  @Column({
    type: 'enum',
    enum: MessageDeliveryStatus,
    enumName: 'chat_messages_delivery_status_enum',
    default: MessageDeliveryStatus.SENT,
  })
  deliveryStatus!: MessageDeliveryStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
