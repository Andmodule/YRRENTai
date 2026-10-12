import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { PropertyEntity } from '../../property/entities/property.entity';

/** What the last auto-extension run did (shown under the switch). */
export type AutoOpenResult = {
  at: string;
  dryRun: boolean;
  from: string;
  toExclusive: string;
  /** Nights opened (or that would be opened in a dry run). */
  opened: number;
  /** Skipped: sold, blocked in RentAI, already open, closed by hand… */
  skipped: number;
  failed: number;
  /** Nights Booking reports differently after the writes. */
  mismatched: number;
  error?: string;
};

/**
 * «Автопродление календаря»: keep the next N days of a property open on Booking.
 * One row per property. Read only while ZODOMUS_CALENDAR_AUTO_OPEN_ENABLED=true
 * (migration 1778500000000-calendar-auto-open-settings).
 */
@Entity('calendar_auto_open_settings')
export class CalendarAutoOpenSettingsEntity {
  @PrimaryColumn('uuid')
  propertyId!: string;

  @OneToOne(() => PropertyEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'propertyId' })
  property!: PropertyEntity;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  /** Days ahead that are kept open, from today in the property time zone. */
  @Column({ type: 'smallint' })
  horizonDays!: number;

  /** Price of a newly opened night, minor units of the Booking currency. */
  @Column({ type: 'integer' })
  priceMinor!: number;

  /** Friday and Saturday nights; null = `priceMinor`. */
  @Column({ type: 'integer', nullable: true })
  weekendPriceMinor!: number | null;

  /**
   * Exclusive end of what auto-extension has handled (yyyy-MM-dd). It only opens nights from here on,
   * so nights before it — closed by hand or never opened — stay as they are.
   */
  @Column({ type: 'varchar', length: 10, nullable: true })
  openedUntil!: string | null;

  /** Nights closed by hand at or beyond `openedUntil`: auto-extension leaves them closed. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  keepClosed!: string[];

  @Column({ type: 'timestamptz', nullable: true })
  lastRunAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  lastResult!: AutoOpenResult | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
