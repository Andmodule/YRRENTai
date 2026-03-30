import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import type { ConversationStatus, ConversationChannel } from '@rentai/shared';
import { PropertyEntity } from '../../property/entities/property.entity';
import { ChatMessageEntity } from './chat-message.entity';

@Entity('conversations')
@Index('IDX_conv_property_status', ['propertyId', 'status'])
@Index('IDX_conv_lastActivity', ['lastActivityAt'])
export class ConversationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  propertyId!: string;

  @ManyToOne(() => PropertyEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'propertyId' })
  property!: PropertyEntity;

  @Column({ type: 'varchar', length: 30, default: 'web_app' })
  channel!: ConversationChannel;

  @Column({ type: 'varchar', length: 30, default: 'ai_handling' })
  status!: ConversationStatus;

  @Column({ type: 'varchar', nullable: true })
  externalGuestKey?: string;

  @Column({ type: 'text', nullable: true })
  lastMessagePreview?: string;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  lastActivityAt!: Date;

  @OneToMany(() => ChatMessageEntity, (m) => m.conversation)
  messages!: ChatMessageEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
