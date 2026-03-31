import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';
import { TaskEntity } from '../../tasks/entities/task.entity';
import { InventoryItemEntity } from './inventory-item.entity';

export type InventoryMovementReason = 'restock' | 'consumption' | 'adjustment' | 'task';

@Entity('inventory_movements')
export class InventoryMovementEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  itemId!: string;

  @ManyToOne(() => InventoryItemEntity, (i) => i.movements, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'itemId' })
  item!: InventoryItemEntity;

  @Column({ type: 'int' })
  delta!: number;

  @Column({ type: 'varchar', length: 32 })
  reason!: InventoryMovementReason;

  @Column({ type: 'uuid', nullable: true })
  taskId!: string | null;

  @ManyToOne(() => TaskEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'taskId' })
  task!: TaskEntity | null;

  @Column('uuid')
  createdBy!: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'createdBy' })
  author!: UserEntity;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
