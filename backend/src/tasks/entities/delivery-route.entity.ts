import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { DeliveryRouteStopEntity } from './delivery-route-stop.entity';
import { CompanyEntity } from '../../user/entities/company.entity';
import { UserEntity } from '../../user/entities/user.entity';

@Entity('delivery_routes')
export class DeliveryRouteEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  companyId!: string;

  @ManyToOne(() => CompanyEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company!: CompanyEntity;

  @Column({ type: 'date' })
  scheduledDate!: string;

  /** Опционально: «выполнить до» (локальное HH:mm, как у задач). */
  @Column({ type: 'varchar', length: 8, nullable: true })
  completeByTime!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  shift!: string | null;

  /** draft | assigned | in_progress | completed | cancelled */
  @Column({ type: 'varchar', length: 32, default: 'draft' })
  status!: string;

  @Column({ type: 'uuid', nullable: true })
  driverUserId!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'driverUserId' })
  driverUser!: UserEntity | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  warehouseLabel!: string | null;

  @Column({ type: 'boolean', default: true })
  driverCanReorderStops!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  /** Следующая точка (объект), выбранная водителем после склада; иначе — первая незакрытая по порядку. */
  @Column({ type: 'uuid', nullable: true })
  driverNextStopId!: string | null;

  @ManyToOne(() => DeliveryRouteStopEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'driverNextStopId' })
  driverNextStop!: DeliveryRouteStopEntity | null;

  @OneToMany(() => DeliveryRouteStopEntity, (s) => s.route, { cascade: true })
  stops!: DeliveryRouteStopEntity[];
}
