import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { DeliveryRouteStopEntity } from './delivery-route-stop.entity';
import { SupplyRequestItemEntity } from './supply-request-item.entity';

@Entity('delivery_stop_supply_lines')
export class DeliveryStopSupplyLineEntity {
  @PrimaryColumn('uuid')
  stopId!: string;

  @PrimaryColumn('uuid')
  supplyRequestItemId!: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  quantity!: string;

  @ManyToOne(() => DeliveryRouteStopEntity, (s) => s.supplyLines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'stopId' })
  stop!: DeliveryRouteStopEntity;

  @ManyToOne(() => SupplyRequestItemEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'supplyRequestItemId' })
  supplyRequestItem!: SupplyRequestItemEntity;
}
