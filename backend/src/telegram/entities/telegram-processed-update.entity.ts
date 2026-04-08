import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** Dedup Telegram webhook retries by (`botScope`, `update_id`). */
@Entity('telegram_processed_updates')
@Unique('UQ_telegram_processed_updates_scope_updateId', ['botScope', 'updateId'])
export class TelegramProcessedUpdateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** `main` — client/manager bot; `staff` — staff bot webhook. */
  @Column({ type: 'varchar', length: 16, default: 'main' })
  botScope!: string;

  @Column({ type: 'bigint' })
  updateId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
