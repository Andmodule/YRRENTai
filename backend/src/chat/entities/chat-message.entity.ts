import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export type MessageSource = 'ai' | 'staff';

@Entity('chat_messages')
export class ChatMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  propertyId!: string;

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
