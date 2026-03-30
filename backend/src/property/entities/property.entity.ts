import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';

@Entity('properties')
export class PropertyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ length: 100, default: '-' })
  country!: string;

  @Column({ length: 100, default: '-' })
  city!: string;

  @Column()
  address!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column()
  timezone!: string;

  @Column({ length: 3, default: 'USD' })
  currency!: string;

  @Column({ nullable: true })
  maxGuests?: number;

  @Column('uuid')
  ownerId!: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'ownerId' })
  owner!: UserEntity;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
