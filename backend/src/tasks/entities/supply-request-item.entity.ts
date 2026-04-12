import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { StaffInterpretationEventEntity } from './staff-interpretation-event.entity';
import { SupplyItemEntity } from './supply-item.entity';
import { DeliveryRouteEntity } from './delivery-route.entity';

@Entity('supply_request_items')
export class SupplyRequestItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  interpretationEventId!: string;

  @ManyToOne(() => StaffInterpretationEventEntity, (e) => e.supplyItems, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'interpretationEventId' })
  interpretationEvent!: StaffInterpretationEventEntity;

  /** Сопоставление со справочником номенклатуры (после разбора LLM). */
  @Column({ type: 'uuid', nullable: true })
  supplyItemId!: string | null;

  @ManyToOne(() => SupplyItemEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'supplyItemId' })
  supplyItem!: SupplyItemEntity | null;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  /** Как в матрице / после нормализации каталога */
  @Column({ type: 'varchar', length: 500 })
  name!: string;

  /** Исходное имя от LLM до маппинга (отладка) */
  @Column({ type: 'varchar', length: 500, nullable: true })
  llmRawName!: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  quantity!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  unit!: string | null;

  /** green | amber | red — заполняется позже правилами склада / MVP null */
  @Column({ type: 'varchar', length: 16, nullable: true })
  trafficLight!: string | null;

  /** pending → в своде; handed_to_driver → передано водителю */
  @Column({ type: 'varchar', length: 32, default: 'pending' })
  lineStatus!: string;

  @Column({ type: 'uuid', nullable: true })
  deliveryRouteId!: string | null;

  @ManyToOne(() => DeliveryRouteEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'deliveryRouteId' })
  deliveryRoute!: DeliveryRouteEntity | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
