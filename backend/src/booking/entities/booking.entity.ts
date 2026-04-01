import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { PropertyEntity } from '../../property/entities/property.entity';

@Entity('bookings')
export class BookingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  propertyId!: string;

  @ManyToOne(() => PropertyEntity)
  @JoinColumn({ name: 'propertyId' })
  property!: PropertyEntity;

  @Column()
  guestName!: string;

  @Column({ nullable: true })
  guestEmail?: string;

  @Column({ nullable: true })
  guestPhone?: string;

  @Column({ type: 'timestamptz' })
  checkIn!: Date;

  @Column({ type: 'timestamptz' })
  checkOut!: Date;

  @Column({ type: 'integer' })
  totalPriceMinor!: number;

  @Column({ length: 3, default: 'USD' })
  currency!: string;

  @Column({ nullable: true })
  guestsCount?: number;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ default: 'PENDING' })
  status!: string;

  @Column({ nullable: true })
  cancelledBy?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, unique: true })
  zodomusReservationId!: string | null;

  /**
   * External UID from an iCal feed (RFC 5545 UID property).
   * Used for deduplication when importing external calendars.
   */
  @Column({ type: 'varchar', length: 512, nullable: true })
  icalUid!: string | null;

  @Column({ type: 'int', nullable: true })
  zodomusChannelId!: number | null;

  @Column({ type: 'boolean', default: false })
  zodomusSynced!: boolean;

  @Column('uuid')
  createdBy!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
