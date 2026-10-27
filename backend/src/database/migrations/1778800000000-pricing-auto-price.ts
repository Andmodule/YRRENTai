import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Цены → Автоцены»: the rule, the per-night adjustments it put on, and its journal.
 * Additive only — three new tables, nothing existing is touched. `down` drops them.
 * Run it BEFORE setting ZODOMUS_PROMOTIONS_AUTOPRICE_ENABLED=true.
 */
export class PricingAutoPrice1778800000000 implements MigrationInterface {
  name = 'PricingAutoPrice1778800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pricing_auto_price_settings" (
        "ownerId" uuid NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "windowKind" varchar(16) NOT NULL,
        "windowDays" smallint NOT NULL,
        "down" jsonb NOT NULL,
        "up" jsonb NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pricing_auto_price_settings" PRIMARY KEY ("ownerId")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "property_auto_prices" (
        "propertyId" uuid NOT NULL,
        "date" date NOT NULL,
        "pct" smallint NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_property_auto_prices" PRIMARY KEY ("propertyId", "date"),
        CONSTRAINT "FK_property_auto_prices_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pricing_auto_price_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "propertyId" uuid NOT NULL,
        "runAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "dryRun" boolean NOT NULL,
        "windowFrom" date,
        "windowTo" date,
        "totalNights" smallint NOT NULL,
        "bookedNights" smallint NOT NULL,
        "pct" smallint NOT NULL,
        "nights" jsonb NOT NULL,
        "result" jsonb NOT NULL,
        CONSTRAINT "PK_pricing_auto_price_runs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pricing_auto_price_runs_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_pricing_auto_price_runs_property_runAt" ON "pricing_auto_price_runs" ("propertyId", "runAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "pricing_auto_price_runs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "property_auto_prices"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "pricing_auto_price_settings"`);
  }
}
