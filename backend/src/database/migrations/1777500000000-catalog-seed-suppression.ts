import { MigrationInterface, QueryRunner } from 'typeorm';

export class CatalogSeedSuppression1777500000000 implements MigrationInterface {
  name = 'CatalogSeedSuppression1777500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "catalog_seed_suppressions" (
        "companyId" uuid NOT NULL,
        "nameNormalized" character varying(255) NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_catalog_seed_suppressions" PRIMARY KEY ("companyId", "nameNormalized"),
        CONSTRAINT "FK_catalog_seed_suppressions_company" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_catalog_seed_suppressions_company" ON "catalog_seed_suppressions" ("companyId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "catalog_seed_suppressions"`);
  }
}
