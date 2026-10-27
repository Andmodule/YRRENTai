import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { AutoNight, DownTier, UpTier } from '../autoprice.util';

/**
 * «Цены → Автоцены»: the tenant's rule. One row per tenant owner; no row = the defaults
 * (autoprice.util.ts), switched off. Read only while ZODOMUS_PROMOTIONS_AUTOPRICE_ENABLED=true.
 */
@Entity('pricing_auto_price_settings')
export class PricingAutoPriceSettingsEntity {
  @PrimaryColumn('uuid')
  ownerId!: string;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  /** 'next' | 'month_end'. */
  @Column({ type: 'varchar', length: 16 })
  windowKind!: 'next' | 'month_end';

  /** 'next': nights ahead; 'month_end': start this many nights before the month ends. */
  @Column({ type: 'smallint' })
  windowDays!: number;

  @Column({ type: 'jsonb' })
  down!: DownTier[];

  @Column({ type: 'jsonb' })
  up!: UpTier[];

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

/**
 * The adjustment the rule put on a night (only when it really sends: not in «Только показывать»).
 * The channel price of the night is then made from base × (100 + pct) / 100; no row = the base as it is.
 */
@Entity('property_auto_prices')
export class PropertyAutoPriceEntity {
  @PrimaryColumn('uuid')
  propertyId!: string;

  /** yyyy-MM-dd, the night. */
  @PrimaryColumn({ type: 'date' })
  date!: string;

  /** Signed percent, e.g. −10 or +5. */
  @Column({ type: 'smallint' })
  pct!: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

export type AutoPriceRunResult = {
  /** Nights the run wanted to change on Booking. */
  changed: number;
  /** Nights whose adjustment was taken off (back to the base). */
  cleared: number;
  /** Booking requests sent; null in «Только показывать». */
  sent: number | null;
  failed: number;
  mismatched: number;
  /** Why nothing could be done (busy, Booking error, not in the pilot …). */
  error?: string;
};

/** «Журнал» of the rule: one row per property and run — what was done or, in «Только показывать», would be. */
@Entity('pricing_auto_price_runs')
@Index(['propertyId', 'runAt'])
export class PricingAutoPriceRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  propertyId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  runAt!: Date;

  @Column({ type: 'boolean' })
  dryRun!: boolean;

  @Column({ type: 'date', nullable: true })
  windowFrom!: string | null;

  @Column({ type: 'date', nullable: true })
  windowTo!: string | null;

  @Column({ type: 'smallint' })
  totalNights!: number;

  @Column({ type: 'smallint' })
  bookedNights!: number;

  /** Signed percent of the run (0 = between the tiers or the rule silent). */
  @Column({ type: 'smallint' })
  pct!: number;

  /** Nights that change (adjusted / lifted to the minimum) and nights cleared back to the base. */
  @Column({ type: 'jsonb' })
  nights!: Array<AutoNight & { cleared?: boolean }>;

  @Column({ type: 'jsonb' })
  result!: AutoPriceRunResult;
}
