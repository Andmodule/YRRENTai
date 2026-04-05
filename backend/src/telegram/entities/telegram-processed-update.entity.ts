import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Dedup Telegram webhook retries by `update_id`. */
@Entity('telegram_processed_updates')
export class TelegramProcessedUpdateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'bigint', unique: true })
  updateId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
