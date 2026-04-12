import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { CompanyEntity } from '../../user/entities/company.entity';
import { UserEntity } from '../../user/entities/user.entity';
import { SupplyItemAliasEntity } from './supply-item-alias.entity';

@Entity('supply_items')
export class SupplyItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  companyId!: string;

  @ManyToOne(() => CompanyEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company!: CompanyEntity;

  /** Каноническое имя в сводной матрице */
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /** consumables | specificity | other */
  @Column({ type: 'varchar', length: 64, default: 'consumables' })
  category!: string;

  /** рулон, шт, охапка — подсказка для UI */
  @Column({ type: 'varchar', length: 64, nullable: true })
  defaultUnit!: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdByUserId' })
  createdBy!: UserEntity | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => SupplyItemAliasEntity, (a) => a.supplyItem)
  aliases!: SupplyItemAliasEntity[];
}
