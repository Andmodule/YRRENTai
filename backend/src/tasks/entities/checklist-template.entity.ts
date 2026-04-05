import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';
import { PropertyEntity } from '../../property/entities/property.entity';
import { CompanyEntity } from '../../user/entities/company.entity';
import { ChecklistTemplateItemEntity } from './checklist-template-item.entity';

@Entity('checklist_templates')
export class ChecklistTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /** Matches TaskEntity.type when auto-applying; null = manual only */
  @Column({ type: 'varchar', length: 32, nullable: true })
  autoApplyToType!: string | null;

  @Column({ type: 'uuid' })
  ownerId!: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'ownerId' })
  owner!: UserEntity;

  @Column({ type: 'uuid' })
  companyId!: string;

  @ManyToOne(() => CompanyEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'companyId' })
  company!: CompanyEntity;

  /** null = global for owner's properties */
  @Column({ type: 'uuid', nullable: true })
  propertyId!: string | null;

  @ManyToOne(() => PropertyEntity, { nullable: true })
  @JoinColumn({ name: 'propertyId' })
  property!: PropertyEntity | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => ChecklistTemplateItemEntity, (i) => i.template, { cascade: true })
  items!: ChecklistTemplateItemEntity[];
}
