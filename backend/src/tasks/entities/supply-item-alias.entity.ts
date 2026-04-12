import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { SupplyItemEntity } from './supply-item.entity';

@Entity('supply_item_aliases')
@Index(['supplyItemId', 'aliasNormalized'], { unique: true })
export class SupplyItemAliasEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  supplyItemId!: string;

  @ManyToOne(() => SupplyItemEntity, (s) => s.aliases, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'supplyItemId' })
  supplyItem!: SupplyItemEntity;

  /** lower(trim), ё→е — для матчинга */
  @Column({ type: 'varchar', length: 255 })
  aliasNormalized!: string;
}
