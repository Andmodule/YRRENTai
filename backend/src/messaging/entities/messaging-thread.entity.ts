import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { MessagingMessageEntity } from './messaging-message.entity';

export type MessagingChannel = 'booking' | 'airbnb' | 'direct';
export type MessagingThreadStatus = 'open' | 'ai_draft' | 'resolved';

@Entity('messaging_threads')
@Index('idx_messaging_threads_owner', ['ownerId'])
@Index('idx_messaging_threads_channel_reservation', ['channel', 'reservationId'])
@Index('idx_messaging_threads_guest_email', ['guestEmail'])
export class MessagingThreadEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  channel!: MessagingChannel;

  @Column({ name: 'reservation_id', type: 'varchar', nullable: true })
  reservationId!: string | null;

  @Column({ name: 'guest_email', type: 'varchar' })
  guestEmail!: string;

  @Column({ name: 'guest_name', type: 'varchar', nullable: true })
  guestName!: string | null;

  /** Last inbound email subject (audit / routing); not shown as message body in chat. */
  @Column({ name: 'last_inbound_subject', type: 'varchar', nullable: true })
  lastInboundSubject!: string | null;

  @Column({ name: 'reply_to', type: 'varchar' })
  replyTo!: string;

  @Column({ type: 'varchar', length: 32, default: 'open' })
  status!: MessagingThreadStatus;

  @Column({ name: 'zodomus_reservation_id', type: 'varchar', nullable: true })
  zodomusReservationId!: string | null;

  @Column({ name: 'property_id', type: 'uuid', nullable: true })
  propertyId!: string | null;

  /** Linked inbox conversation (`chats/conversations`) when email is mirrored to the chat UI */
  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId!: string | null;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => MessagingMessageEntity, (m) => m.thread)
  messages!: MessagingMessageEntity[];
}
