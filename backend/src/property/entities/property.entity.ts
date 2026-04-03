import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';
import { OtaPlatformEntity } from './ota-platform.entity';

@Entity('properties')
export class PropertyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ length: 100, default: '-' })
  country!: string;

  @Column({ length: 100, default: '-' })
  city!: string;

  @Column()
  address!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column()
  timezone!: string;

  @Column({ length: 3, default: 'USD' })
  currency!: string;

  @Column({ nullable: true })
  maxGuests?: number;

  /** External property id in Zodomus (for reservations-queue / sync). */
  @Column({ type: 'varchar', length: 255, nullable: true, unique: true })
  zodomusPropertyId!: string | null;

  /**
   * Zodomus room id for POST /availability.
   * If unset, the first room from GET /room-rates is used — wrong when Zodomus exposes multiple rooms; set explicitly.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  zodomusRoomId!: string | null;

  /** True when last POST /availability failed or was partial — cron retries until success. */
  @Column({ type: 'boolean', default: false })
  zodomusAvailabilityDirty!: boolean;

  /**
   * List of external iCal feed URLs to import (Airbnb, VRBO, etc.).
   * Stored as jsonb array of strings.
   */
  @Column({ type: 'jsonb', nullable: true, default: '[]' })
  icalImportUrls!: string[];

  @Column({ type: 'uuid', nullable: true })
  otaPlatformId!: string | null;

  @ManyToOne(() => OtaPlatformEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'otaPlatformId' })
  otaPlatform!: OtaPlatformEntity | null;

  @Column('uuid')
  ownerId!: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'ownerId' })
  owner!: UserEntity;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
