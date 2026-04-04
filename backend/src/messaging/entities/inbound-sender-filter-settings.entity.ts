import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('inbound_sender_filter_settings')
export class InboundSenderFilterSettingsEntity {
  @PrimaryColumn('varchar', { length: 32, default: 'default' })
  id!: string;

  @Column({ type: 'jsonb', name: 'allowed_hosts' })
  allowedHosts!: string[];

  @Column({ type: 'boolean', name: 'allow_gmail_googlemail' })
  allowGmailGooglemail!: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
