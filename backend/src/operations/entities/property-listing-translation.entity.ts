import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { PropertyEntity } from '../../property/entities/property.entity';

@Entity('property_listing_translations')
@Unique(['propertyId', 'locale'])
export class PropertyListingTranslationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  propertyId!: string;

  @ManyToOne(() => PropertyEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'propertyId' })
  property!: PropertyEntity;

  /** BCP 47 / channel locale: en, ru, pl, de, es */
  @Column({ type: 'varchar', length: 10 })
  locale!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  title!: string | null;

  @Column({ type: 'text', nullable: true })
  shortDescription!: string | null;

  @Column({ type: 'text', nullable: true })
  longDescription!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
