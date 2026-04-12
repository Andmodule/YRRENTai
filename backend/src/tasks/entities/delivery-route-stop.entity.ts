import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { PropertyEntity } from '../../property/entities/property.entity';
import { DeliveryRouteEntity } from './delivery-route.entity';
import { DeliveryStopSupplyLineEntity } from './delivery-stop-supply-line.entity';

@Entity('delivery_route_stops')
export class DeliveryRouteStopEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  routeId!: string;

  @ManyToOne(() => DeliveryRouteEntity, (r) => r.stops, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'routeId' })
  route!: DeliveryRouteEntity;

  @Column({ type: 'int' })
  sortOrder!: number;

  /** warehouse | property */
  @Column({ type: 'varchar', length: 32 })
  kind!: string;

  @Column({ type: 'uuid', nullable: true })
  propertyId!: string | null;

  @ManyToOne(() => PropertyEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'propertyId' })
  property!: PropertyEntity | null;

  /** pending | arrived | done */
  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status!: string;

  @Column({ type: 'timestamptz', nullable: true })
  arrivedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => DeliveryStopSupplyLineEntity, (l) => l.stop, { cascade: true })
  supplyLines!: DeliveryStopSupplyLineEntity[];
}
