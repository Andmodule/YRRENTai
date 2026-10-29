import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * The Airbnb host of an owner, as connected through Zodomus: the token of POST /airbnb-host-activation
 * (sent again with host-status, listings and the listing activation) and the last host status seen.
 * Read only while ZODOMUS_AIRBNB_ENABLED=true (migration 1778900000000-zodomus-airbnb-hosts).
 */
@Entity('zodomus_airbnb_hosts')
export class ZodomusAirbnbHostEntity {
  @PrimaryColumn('uuid')
  ownerId!: string;

  @Column({ type: 'varchar', length: 255 })
  token!: string;

  @Column({ type: 'varchar', length: 255 })
  clientId!: string;

  /** 5 = «Host is active». */
  @Column({ type: 'integer', nullable: true })
  statusCode!: number | null;

  @Column({ type: 'text', nullable: true })
  statusText!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  checkedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
