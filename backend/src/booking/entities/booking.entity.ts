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
import { GuestEntity } from '../../guest/entities/guest.entity';
import type { DirectBookingSource } from '@rentai/shared';

@Entity('bookings')
export class BookingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  propertyId!: string;

  @ManyToOne(() => PropertyEntity)
  @JoinColumn({ name: 'propertyId' })
  property!: PropertyEntity;

  @Column({ type: 'uuid', nullable: true })
  guestId!: string | null;

  @ManyToOne(() => GuestEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'guestId' })
  guest!: GuestEntity | null;

  @Column()
  guestName!: string;

  @Column({ nullable: true })
  guestEmail?: string;

  /**
   * Booking.com proxy address for this reservation (e.g. *@guest.booking.com) — inbound email routing.
   */
  @Column({ name: 'guest_email_alias', type: 'varchar', length: 255, nullable: true })
  guestEmailAlias!: string | null;

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

  /** From OTA room line when adults+children sum is used (Zodomus). */
  @Column({ type: 'int', nullable: true })
  guestsAdults?: number;

  @Column({ type: 'int', nullable: true })
  guestsChildren?: number;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  /** Team-only notes (not overwritten by OTA sync). */
  @Column({ type: 'text', nullable: true })
  internalNotes?: string | null;

  /** Simple payment tracking for managers. */
  @Column({ type: 'varchar', length: 16, default: 'unpaid' })
  paymentStatus!: 'unpaid' | 'partial' | 'paid';

  /** Short label from OTA payload (Zodomus) — payment / payout type when provided by channel. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  otaPaymentHint!: string | null;

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

  /** Set for manual direct bookings only (zodomusChannelId is null). */
  @Column({ type: 'varchar', length: 32, nullable: true })
  directSource!: DirectBookingSource | null;

  @Column({ type: 'boolean', default: false })
  zodomusSynced!: boolean;

  @Column('uuid')
  createdBy!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
