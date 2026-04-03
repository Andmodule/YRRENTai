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

@Entity('guests')
export class GuestEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  ownerId!: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'ownerId' })
  owner!: UserEntity;

  @Column()
  displayName!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phoneNormalized!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  emailNormalized!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
