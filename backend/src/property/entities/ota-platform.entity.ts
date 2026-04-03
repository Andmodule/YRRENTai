import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/** Детерминированный список OTA для UX (Booking, Airbnb, …). */
@Entity('ota_platforms')
export class OtaPlatformEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32, unique: true })
  code!: string;

  /** Id канала в Zodomus (GET /channels / маппинг в коде). */
  @Column({ type: 'integer' })
  zodomusChannelId!: number;

  @Column({ type: 'integer', default: 0 })
  sortOrder!: number;
}
