import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('property_notification_settings')
export class PropertyNotificationSettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid', { unique: true })
  propertyId!: string;

  /** Telegram chat_id of the manager responsible for this property */
  @Column({ nullable: true })
  telegramChatId?: string;
}
