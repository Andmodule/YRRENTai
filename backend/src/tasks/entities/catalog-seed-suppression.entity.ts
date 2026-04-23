import { Entity, PrimaryColumn, CreateDateColumn } from 'typeorm';

/**
 * Позиция из DEFAULT_SEED, которую для компании намеренно удалили — не вставлять снова при ensureDefaultCatalogForCompany.
 */
@Entity('catalog_seed_suppressions')
export class CatalogSeedSuppressionEntity {
  @PrimaryColumn({ type: 'uuid' })
  companyId!: string;

  @PrimaryColumn({ type: 'varchar', length: 255 })
  nameNormalized!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
