import { MigrationInterface, QueryRunner } from 'typeorm';

export class OperationsInventoryListingsReports1773200000000 implements MigrationInterface {
  name = 'OperationsInventoryListingsReports1773200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inventory_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "propertyId" uuid NOT NULL,
        "name" character varying(255) NOT NULL,
        "sku" character varying(64) NULL,
        "category" character varying(32) NOT NULL DEFAULT 'other',
        "unit" character varying(32) NOT NULL DEFAULT 'pcs',
        "currentStock" integer NOT NULL DEFAULT 0,
        "lowStockThreshold" integer NOT NULL DEFAULT 0,
        "notes" text NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inventory_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_inventory_items_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_inventory_items_propertyId" ON "inventory_items" ("propertyId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inventory_movements" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "itemId" uuid NOT NULL,
        "delta" integer NOT NULL,
        "reason" character varying(32) NOT NULL,
        "taskId" uuid NULL,
        "createdBy" uuid NOT NULL,
        "note" text NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inventory_movements" PRIMARY KEY ("id"),
        CONSTRAINT "FK_inventory_movements_item" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_inventory_movements_task" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_inventory_movements_user" FOREIGN KEY ("createdBy") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_inventory_movements_itemId" ON "inventory_movements" ("itemId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "property_listing_translations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "propertyId" uuid NOT NULL,
        "locale" character varying(10) NOT NULL,
        "title" character varying(500) NULL,
        "shortDescription" text NULL,
        "longDescription" text NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_property_listing_translations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_plt_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_property_locale" UNIQUE ("propertyId", "locale")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_plt_propertyId" ON "property_listing_translations" ("propertyId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_movements"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "property_listing_translations"`);
  }
}
