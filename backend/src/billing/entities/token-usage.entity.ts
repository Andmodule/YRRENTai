import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('token_usage')
export class TokenUsageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  propertyId!: string;

  @Column('uuid')
  userId!: string;

  @Column({ type: 'integer' })
  tokensUsed!: number;

  @Column()
  provider!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
