import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { TaskEntity } from './task.entity';
import { UserEntity } from '../../user/entities/user.entity';

@Entity('task_checklist_items')
export class TaskChecklistItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  taskId!: string;

  @ManyToOne(() => TaskEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'taskId' })
  task!: TaskEntity;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'boolean', default: false })
  required!: boolean;

  @Column({ name: 'sortOrder', type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'boolean', default: false })
  checked!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  checkedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  checkedBy!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'checkedBy' })
  checkedByUser!: UserEntity | null;
}
