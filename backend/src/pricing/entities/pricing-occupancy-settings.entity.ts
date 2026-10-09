import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { OccupancyTier } from '../pricing-occupancy.util';

/**
 * «Цены → Заполненность»: the tenant's own thresholds («сдано меньше X% → скидка Y%»).
 * One row per tenant owner; no row = the defaults from pricing-occupancy.util.ts.
 * Read only while ZODOMUS_PROMOTIONS_OCCUPANCY_ENABLED=true.
 */
@Entity('pricing_occupancy_settings')
export class PricingOccupancySettingsEntity {
  @PrimaryColumn('uuid')
  ownerId!: string;

  /** How many nights ahead are counted. */
  @Column({ type: 'smallint' })
  horizonDays!: number;

  @Column({ type: 'jsonb' })
  tiers!: OccupancyTier[];

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
