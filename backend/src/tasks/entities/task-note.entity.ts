import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TaskEntity } from './task.entity';
import { UserEntity } from '../../user/entities/user.entity';

@Entity('task_notes')
export class TaskNoteEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  taskId!: string;

  @ManyToOne(() => TaskEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'taskId' })
  task!: TaskEntity;

  @Column({ type: 'uuid' })
  authorId!: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'authorId' })
  author!: UserEntity;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  photoUrl!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
