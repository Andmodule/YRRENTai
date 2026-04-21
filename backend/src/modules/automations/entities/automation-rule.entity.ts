import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { PropertyEntity } from '../../../property/entities/property.entity';

export const AUTOMATION_RULE_CATEGORIES = [
  'operations',
  'guests',
  'smart-home',
  'revenue',
  'support',
] as const;

export type AutomationRuleCategory = (typeof AUTOMATION_RULE_CATEGORIES)[number];

export const AUTOMATION_RULE_STATUSES = ['active', 'inactive'] as const;
export type AutomationRuleStatus = (typeof AUTOMATION_RULE_STATUSES)[number];

@Entity('automation_rules')
@Unique('UQ_automation_rules_property_key', ['propertyId', 'key'])
@Index('IDX_automation_rules_property_category', ['propertyId', 'category'])
@Index('IDX_automation_rules_property_status', ['propertyId', 'status'])
export class AutomationRuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  propertyId!: string;

  @ManyToOne(() => PropertyEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'propertyId' })
  property!: PropertyEntity;

  /** Stable rule identifier within a property (e.g. CLEANER_DELAYED). */
  @Column({ length: 128 })
  key!: string;

  @Column({ type: 'varchar', length: 32 })
  category!: AutomationRuleCategory;

  @Column({ type: 'varchar', length: 16, default: 'inactive' })
  status!: AutomationRuleStatus;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  params!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
