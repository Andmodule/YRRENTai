import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PropertyEntity } from '../../property/entities/property.entity';
import type { GuestPriceInput } from '../guest-price.util';
import type { GuestPriceChannel } from './property-channel-profile.entity';

export type GuestPriceScenario = 'min' | 'regular';

/**
 * Calibration: a guest total seen on the channel itself (a screenshot of the booking page) next to
 * what RentAI calculated for the same stay at that moment.
 */
@Entity('price_observations')
@Index('IDX_price_observations_property', ['propertyId', 'createdAt'])
export class PriceObservationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  propertyId!: string;

  @ManyToOne(() => PropertyEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'propertyId' })
  property!: PropertyEntity;

  @Column({ type: 'varchar', length: 16 })
  channel!: GuestPriceChannel;

  @Column({ type: 'date' })
  checkIn!: string;

  @Column({ type: 'smallint' })
  nights!: number;

  @Column({ type: 'smallint' })
  guests!: number;

  @Column({ type: 'varchar', length: 16 })
  scenario!: GuestPriceScenario;

  @Column({ type: 'integer' })
  observedTotalMinor!: number;

  /** Recalculated on the server from `input`. */
  @Column({ type: 'integer' })
  calculatedTotalMinor!: number;

  /** What the calculation was made of — to see later what RentAI did not know. */
  @Column({ type: 'jsonb' })
  input!: GuestPriceInput;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
