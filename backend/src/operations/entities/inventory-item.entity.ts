import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { PropertyEntity } from '../../property/entities/property.entity';
import { InventoryMovementEntity } from './inventory-movement.entity';

export type InventoryCategory = 'minibar' | 'supplies' | 'linen' | 'other';

@Entity('inventory_items')
export class InventoryItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  propertyId!: string;

  @ManyToOne(() => PropertyEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'propertyId' })
  property!: PropertyEntity;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  sku!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'other' })
  category!: InventoryCategory;

  @Column({ type: 'varchar', length: 32, default: 'pcs' })
  unit!: string;

  @Column({ type: 'int', default: 0 })
  currentStock!: number;

  @Column({ type: 'int', default: 0 })
  lowStockThreshold!: number;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @OneToMany(() => InventoryMovementEntity, (m) => m.item)
  movements!: InventoryMovementEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
