import { Entity, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity('whatsapp_processed_messages')
export class WhatsappProcessedMessageEntity {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  wamid!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
