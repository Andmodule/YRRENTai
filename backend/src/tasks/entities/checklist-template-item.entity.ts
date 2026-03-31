import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { ChecklistTemplateEntity } from './checklist-template.entity';

@Entity('checklist_template_items')
export class ChecklistTemplateItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  templateId!: string;

  @ManyToOne(() => ChecklistTemplateEntity, (t) => t.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'templateId' })
  template!: ChecklistTemplateEntity;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'boolean', default: false })
  required!: boolean;

  @Column({ name: 'sortOrder', type: 'int', default: 0 })
  sortOrder!: number;
}
