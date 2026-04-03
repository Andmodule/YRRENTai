import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { PropertyEntity } from './property.entity';
import { OtaPlatformEntity } from './ota-platform.entity';

/** Внешний id объекта в конкретном OTA-канале (Zodomus / Booking / Airbnb и т.д.). */
@Entity('property_channel_listings')
@Index('IDX_property_channel_listings_property', ['propertyId'])
export class PropertyChannelListingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  propertyId!: string;

  @ManyToOne(() => PropertyEntity, (p) => p.channelListings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'propertyId' })
  property!: PropertyEntity;

  @Column('uuid')
  otaPlatformId!: string;

  @ManyToOne(() => OtaPlatformEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'otaPlatformId' })
  otaPlatform!: OtaPlatformEntity;

  @Column({ type: 'varchar', length: 255 })
  externalListingId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  zodomusRoomId!: string | null;

  @Column({ type: 'integer', default: 0 })
  sortOrder!: number;
}
