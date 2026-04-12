import { MigrationInterface, QueryRunner } from 'typeorm';

export class SupplyCatalogMatrix1776700000000 implements MigrationInterface {
  name = 'SupplyCatalogMatrix1776700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "supply_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "companyId" uuid NOT NULL,
        "name" character varying(255) NOT NULL,
        "category" character varying(64) NOT NULL DEFAULT 'consumables',
        "defaultUnit" character varying(64) NULL,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdByUserId" uuid NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_supply_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_supply_items_company" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_supply_items_author" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_supply_items_company" ON "supply_items" ("companyId")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "supply_item_aliases" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "supplyItemId" uuid NOT NULL,
        "aliasNormalized" character varying(255) NOT NULL,
        CONSTRAINT "PK_supply_item_aliases" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_supply_alias_item_norm" UNIQUE ("supplyItemId", "aliasNormalized"),
        CONSTRAINT "FK_supply_alias_item" FOREIGN KEY ("supplyItemId") REFERENCES "supply_items"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_supply_alias_norm" ON "supply_item_aliases" ("aliasNormalized")`,
    );

    await queryRunner.query(`
      ALTER TABLE "supply_request_items"
      ADD COLUMN IF NOT EXISTS "supplyItemId" uuid NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "supply_request_items"
      ADD COLUMN IF NOT EXISTS "llmRawName" character varying(500) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "supply_request_items"
      ADD COLUMN IF NOT EXISTS "lineStatus" character varying(32) NOT NULL DEFAULT 'pending'
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "supply_request_items"
        ADD CONSTRAINT "FK_supply_request_item_catalog"
        FOREIGN KEY ("supplyItemId") REFERENCES "supply_items"("id") ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "supply_request_items" DROP CONSTRAINT IF EXISTS "FK_supply_request_item_catalog"`,
    );
    await queryRunner.query(`ALTER TABLE "supply_request_items" DROP COLUMN IF EXISTS "lineStatus"`);
    await queryRunner.query(`ALTER TABLE "supply_request_items" DROP COLUMN IF EXISTS "llmRawName"`);
    await queryRunner.query(`ALTER TABLE "supply_request_items" DROP COLUMN IF EXISTS "supplyItemId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "supply_item_aliases"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "supply_items"`);
  }
}
